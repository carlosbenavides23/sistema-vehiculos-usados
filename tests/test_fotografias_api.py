"""Contrato HTTP de fotos con DB/Storage falsos; Pillow sí decodifica imágenes."""

from io import BytesIO
import os
import unittest
from uuid import uuid4

os.environ.setdefault("FLASK_SECRET_KEY", "clave-solo-para-pruebas")

from app import create_app
import almacenamiento
from test_api import limite_falso, repositorio_falso
from test_imagenes import imagen_bytes
from test_vehiculos import formulario
from werkzeug.security import generate_password_hash
from vehiculos import validar_vehiculo


class StorageFalso:
    def __init__(self):
        self.objetos = {}
        self.fallar_subida = False
        self.fallar_borrado = False
        self.subidas = 0

    def subir(self, ruta, contenido):
        self.subidas += 1
        if self.fallar_subida:
            raise almacenamiento.ErrorAlmacenamiento()
        self.objetos.setdefault(ruta, contenido)

    def eliminar(self, ruta):
        if self.fallar_borrado:
            raise almacenamiento.ErrorAlmacenamiento()
        self.objetos.pop(ruta, None)

    def url_publica(self, ruta):
        return f"https://rtcygltmrtulyeezaaac.supabase.co/storage/v1/object/public/vehiculos/{ruta}"


class RepositorioFotosFalso:
    """Modelo de contrato para fallos; no simula transacciones PostgreSQL reales."""
    def __init__(self):
        self.fotos = []
        self.reservas = {}
        self.cola = []
        self.siguiente = 1
        self.fallar_guardado = False

    def interfaz(self):
        return {nombre: getattr(self, nombre) for nombre in ("listar_fotografias", "listar_por_vehiculos", "preparar_subida", "guardar_fotografia", "eliminar_fotografia", "cancelar_subida", "pendientes_limpieza", "reclamar_limpieza", "confirmar_limpieza")}

    def listar_fotografias(self, identificador):
        return [dict(foto) for foto in self.fotos if foto["vehiculo_id"] == identificador]

    def listar_por_vehiculos(self, ids):
        return {identificador: self.listar_fotografias(identificador) for identificador in ids}

    def preparar_subida(self, vehiculo, clave, huella, fotografia_id=None):
        if vehiculo != 1 or fotografia_id is not None and not any(f["id"] == fotografia_id for f in self.fotos):
            raise LookupError()
        anterior = self.reservas.get(clave)
        if anterior:
            if anterior["huella"] != huella or anterior["target"] != fotografia_id:
                raise ValueError()
            return dict(anterior)
        if fotografia_id is None and len(self.fotos) >= 5:
            raise ValueError()
        reserva = {"storage_path": f"{vehiculo}/{uuid4().hex}.webp", "completada": False, "huella": huella, "target": fotografia_id}
        self.reservas[clave] = reserva
        return dict(reserva)

    def guardar_fotografia(self, vehiculo, datos, clave, fotografia_id=None):
        if self.fallar_guardado:
            raise RuntimeError("password=dato-interno")
        if fotografia_id is not None:
            foto = next(f for f in self.fotos if f["id"] == fotografia_id)
            self.cola.append(foto["storage_path"])
            foto.update(datos)
        else:
            foto = {"id": self.siguiente, "vehiculo_id": vehiculo, "orden": len(self.fotos) + 1, **datos}
            self.siguiente += 1
            self.fotos.append(foto)
        self.reservas[clave].update({"completada": True, "fotografia": dict(foto)})
        return dict(foto)

    def eliminar_fotografia(self, vehiculo, foto_id):
        foto = next((f for f in self.fotos if f["id"] == foto_id and f["vehiculo_id"] == vehiculo), None)
        if foto is None:
            return False
        self.fotos.remove(foto)
        self.cola.append(foto["storage_path"])
        return True

    def cancelar_subida(self, ruta):
        if not any(f["storage_path"] == ruta for f in self.fotos):
            self.cola.append(ruta)

    def pendientes_limpieza(self, limite):
        return [{"id": ruta, "storage_path": ruta} for ruta in self.cola[:limite] if not any(f["storage_path"] == ruta for f in self.fotos)]

    def confirmar_limpieza(self, ruta):
        self.cola.remove(ruta)

    def reclamar_limpieza(self, ruta):
        return not any(f["storage_path"] == ruta for f in self.fotos)


class FotografiasApiTest(unittest.TestCase):
    def setUp(self):
        self.repo = repositorio_falso()
        normalizado, _ = validar_vehiculo(formulario())
        self.repo["crear_vehiculo"](normalizado)
        self.fotos = RepositorioFotosFalso()
        self.storage = StorageFalso()
        self.app = create_app({"TESTING": True, "SECRET_KEY": "test", "ADMIN_PASSWORD_HASH": generate_password_hash("clave"), "SESSION_COOKIE_SECURE": False, "APP_READ_ONLY": False, "REPOSITORY": self.repo, "PHOTO_REPOSITORY": self.fotos.interfaz(), "LOGIN_LIMITER": limite_falso(), "STORAGE": self.storage})
        self.cliente = self.app.test_client()
        self.cliente.get("/")
        with self.cliente.session_transaction() as sesion:
            token = sesion["csrf_token"]
        respuesta = self.cliente.post("/api/admin/login", json={"password": "clave"}, headers={"X-CSRF-Token": token})
        self.token = respuesta.json["csrf_token"]

    def subir(self, foto_id=None, clave=None, contenido=None):
        ruta = "/api/vehiculos/1/fotografias" + (f"/{foto_id}" if foto_id is not None else "")
        return self.cliente.open(ruta, method="PUT" if foto_id is not None else "POST", data={"fotografia": (BytesIO(contenido if contenido is not None else imagen_bytes()), "archivo.png")}, headers={"X-CSRF-Token": self.token, "Idempotency-Key": clave or str(uuid4())})

    def test_sube_una_vez_y_repite_sin_duplicar(self):
        clave = str(uuid4())
        primera = self.subir(clave=clave)
        repetida = self.subir(clave=clave)
        self.assertEqual(primera.status_code, 201)
        self.assertEqual(repetida.json["fotografia"]["id"], primera.json["fotografia"]["id"])
        self.assertEqual(len(self.fotos.fotos), 1)
        self.assertEqual(self.storage.subidas, 1)
        self.assertEqual(primera.json["fotografia"]["mime_type"], "image/webp")
        publico = self.app.test_client().get("/api/vehiculos")
        self.assertEqual(len(publico.json["vehiculos"][0]["fotografias"]), 1)

    def test_sustitucion_confirma_nueva_antes_de_eliminar_anterior(self):
        primera = self.subir().json["fotografia"]
        anterior = primera["storage_path"]
        self.fotos.fallar_guardado = True
        fallo = self.subir(primera["id"], contenido=imagen_bytes("JPEG"))
        self.assertEqual(fallo.status_code, 503)
        self.assertEqual(self.fotos.fotos[0]["storage_path"], anterior)
        self.assertIn(anterior, self.storage.objetos)
        self.assertNotIn("dato-interno", fallo.get_data(as_text=True))
        self.fotos.fallar_guardado = False
        exito = self.subir(primera["id"], contenido=imagen_bytes("JPEG"))
        self.assertEqual(exito.status_code, 200)
        self.assertEqual(exito.json["fotografia"]["id"], primera["id"])
        self.assertNotEqual(exito.json["fotografia"]["storage_path"], anterior)
        self.assertNotIn(anterior, self.storage.objetos)

    def test_fallo_storage_no_sustituye_y_eliminacion_pendiente_se_recupera(self):
        foto = self.subir().json["fotografia"]
        self.storage.fallar_subida = True
        fallo = self.subir(foto["id"])
        self.assertEqual(fallo.status_code, 503)
        self.assertEqual(self.fotos.fotos[0]["storage_path"], foto["storage_path"])
        self.storage.fallar_subida = False
        self.storage.fallar_borrado = True
        borrada = self.cliente.delete(f"/api/vehiculos/1/fotografias/{foto['id']}", headers={"X-CSRF-Token": self.token})
        self.assertEqual(borrada.status_code, 200)
        self.assertEqual(borrada.json["fotografias"], [])
        self.assertTrue(borrada.json["limpieza_pendiente"])
        self.assertIn(foto["storage_path"], self.storage.objetos)
        self.storage.fallar_borrado = False
        resultado = almacenamiento.limpiar_pendientes(aplicar=True, repositorio=lambda nombre, *args: self.fotos.interfaz()[nombre](*args), proveedor=self.storage)
        self.assertEqual(resultado["eliminados"], 1)
        self.assertNotIn(foto["storage_path"], self.storage.objetos)

    def test_limite_cinco_y_rechazo_de_archivos_invalidos(self):
        for _ in range(5):
            self.assertEqual(self.subir().status_code, 201)
        self.assertEqual(self.subir().status_code, 409)
        self.assertEqual(self.subir(contenido=b"no es una imagen").status_code, 422)
        self.assertEqual(len(self.fotos.fotos), 5)

    def test_autorizacion_csrf_y_limite_de_solicitud(self):
        publico = self.app.test_client()
        self.assertEqual(publico.post("/api/vehiculos/1/fotografias").status_code, 401)
        self.assertEqual(self.cliente.delete("/api/vehiculos/1/fotografias/1").status_code, 403)
        enorme = self.cliente.post("/api/vehiculos/1/fotografias", data=b"x" * 1_100_001, content_type="multipart/form-data; boundary=demo", headers={"X-CSRF-Token": self.token, "Idempotency-Key": str(uuid4())})
        self.assertEqual(enorme.status_code, 413)
        self.assertEqual(self.storage.subidas, 0)


if __name__ == "__main__":
    unittest.main()
