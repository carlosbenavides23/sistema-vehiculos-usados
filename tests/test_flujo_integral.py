"""Flask + PostgreSQL reales; Storage es un doble explícito, sin red remota."""

from io import BytesIO
import os
import unittest
from unittest.mock import patch
import uuid

os.environ.setdefault("FLASK_SECRET_KEY", "clave-exclusiva-del-test-local")

from PIL import Image
from werkzeug.security import generate_password_hash

import almacenamiento
from app import create_app
import persistencia
import persistencia_fotos
from test_postgres_integracion import base_aislada


class StorageDoble:
    def __init__(self):
        self.objetos = {}
        self.fallar_subida = False
        self.fallar_borrado = False
        self.borrado_inseguro = False

    def subir(self, ruta, contenido):
        if self.fallar_subida:
            raise almacenamiento.ErrorAlmacenamiento("Storage de prueba no disponible.")
        if ruta in self.objetos:
            return False
        self.objetos[ruta] = contenido
        return True

    def eliminar(self, ruta):
        with persistencia._conectar() as conexion:
            if conexion.execute("SELECT 1 FROM public.vehiculo_fotografias WHERE storage_path = %s", (ruta,)).fetchone():
                self.borrado_inseguro = True
                raise AssertionError("Se intentó borrar un objeto todavía referenciado.")
        if self.fallar_borrado:
            raise almacenamiento.ErrorAlmacenamiento("Borrado de prueba no disponible.")
        self.objetos.pop(ruta, None)

    def url_publica(self, ruta):
        return f"https://storage.example.invalid/{ruta}"


def formulario(modelo="Vehículo de integración", **extras):
    return {
        "marca": "Grupo 7", "modelo": modelo, "anio": 2022, "kilometraje": 12345,
        "precio_venta": "12345.67", "ubicacion": "Managua", "descripcion": "Datos exclusivamente ficticios de integración.",
        "disponibilidad": "disponible", "placa": "PRUEBA-PRIVADA", "color": "Azul",
        "aire_acondicionado": True, "ventanas_electricas": False, "pantalla_multimedia": None,
        **extras,
    }


def png(color="blue"):
    salida = BytesIO()
    Image.new("RGB", (180, 120), color).save(salida, "PNG")
    return salida.getvalue()


@unittest.skipUnless(os.environ.get("TEST_DATABASE_URL"), "Requiere TEST_DATABASE_URL PostgreSQL local aislado")
class FlujoIntegralTest(unittest.TestCase):
    def setUp(self):
        aislamiento = base_aislada()
        self.dsn = aislamiento.__enter__()
        self.addCleanup(aislamiento.__exit__, None, None, None)
        self.storage = StorageDoble()
        self.app = create_app({
            "TESTING": True, "SECRET_KEY": "secreto-test-integral",
            "ADMIN_PASSWORD_HASH": generate_password_hash("acceso-test-integral"),
            "SESSION_COOKIE_SECURE": False, "APP_READ_ONLY": False, "STORAGE": self.storage,
        })
        self.cliente = self.app.test_client()
        self.cliente.get("/")

    def csrf(self, cliente=None):
        with (cliente or self.cliente).session_transaction() as sesion:
            return sesion["csrf_token"]

    def entrar(self):
        respuesta = self.cliente.post("/api/admin/login", json={"password": "acceso-test-integral"}, headers={"X-CSRF-Token": self.csrf()})
        self.assertEqual(respuesta.status_code, 200, respuesta.json)

    def headers(self, clave=None):
        return {"X-CSRF-Token": self.csrf(), "Idempotency-Key": clave or str(uuid.uuid4())}

    def crear(self):
        respuesta = self.cliente.post("/api/vehiculos", json={"vehiculo": formulario()}, headers=self.headers())
        self.assertEqual(respuesta.status_code, 201, respuesta.json)
        return respuesta.json["vehiculo"]["id"]

    def subir(self, vehiculo_id, contenido=None, clave=None, foto_id=None):
        ruta = f"/api/vehiculos/{vehiculo_id}/fotografias"
        if foto_id is not None:
            ruta += f"/{foto_id}"
        return self.cliente.open(ruta, method="PUT" if foto_id is not None else "POST",
                                 data={"fotografia": (BytesIO(contenido or png()), "imagen.png")}, headers=self.headers(clave))

    def test_catalogo_crud_persistencia_idempotencia_y_semillas_intactas(self):
        inicial = self.cliente.get("/api/vehiculos")
        self.assertEqual(len(inicial.json["vehiculos"]), 6)
        originales = inicial.json["vehiculos"]
        self.assertEqual(self.cliente.post("/api/vehiculos", json={"vehiculo": formulario()}).status_code, 401)
        self.entrar()
        clave = str(uuid.uuid4())
        primera = self.cliente.post("/api/vehiculos", json={"vehiculo": formulario()}, headers=self.headers(clave))
        repetida = self.cliente.post("/api/vehiculos", json={"vehiculo": formulario()}, headers=self.headers(clave))
        self.assertEqual(primera.json["vehiculo"]["id"], repetida.json["vehiculo"]["id"])
        identificador = primera.json["vehiculo"]["id"]
        distinta = self.cliente.post("/api/vehiculos", json={"vehiculo": formulario(modelo="Otro")}, headers=self.headers(clave))
        self.assertEqual(distinta.status_code, 409)
        self.assertEqual(self.cliente.put(f"/api/vehiculos/{identificador}", json={"vehiculo": formulario()}, headers={}).status_code, 403)
        editada = self.cliente.put(f"/api/vehiculos/{identificador}", json={"vehiculo": formulario(modelo="Editado")}, headers=self.headers())
        self.assertEqual(editada.json["vehiculo"]["id"], identificador)
        self.assertTrue(editada.json["vehiculo"]["aire_acondicionado"])
        self.assertFalse(editada.json["vehiculo"]["ventanas_electricas"])
        self.assertIsNone(editada.json["vehiculo"]["pantalla_multimedia"])
        self.cliente.patch(f"/api/vehiculos/{identificador}/disponibilidad", json={"disponibilidad": "vendido"}, headers=self.headers())
        lector = self.app.test_client()
        registro = lector.get(f"/api/vehiculos/{identificador}").json["vehiculo"]
        self.assertEqual(registro["modelo"], "Editado")
        self.assertEqual(registro["disponibilidad"], "vendido")
        self.assertNotIn("placa", registro)
        final = lector.get("/api/vehiculos").json["vehiculos"]
        self.assertEqual(final[:6], originales)
        self.assertEqual(len(final), 7)

    def test_busqueda_publica_y_ficha_compartible_con_postgres(self):
        self.entrar()
        configuraciones = (
            ("bajo", 2020, "12000", "disponible", "SUV"),
            ("medio", 2021, "15000", "disponible", "SUV"),
            ("alto año", 2022, "15000", "disponible", "SUV"),
            ("vendido", 2021, "15000", "vendido", "SUV"),
            ("sedán", 2021, "15000", "disponible", "Sedán"),
        )
        publicados = []
        for etiqueta, anio, precio, disponibilidad, tipo in configuraciones:
            datos = formulario(
                modelo=f"Zquery {etiqueta}", marca="Nissan", anio=anio,
                precio_venta=precio, disponibilidad=disponibilidad,
                tipo_vehiculo=tipo,
            )
            respuesta = self.cliente.post(
                "/api/vehiculos", json={"vehiculo": datos},
                headers=self.headers(),
            )
            self.assertEqual(respuesta.status_code, 201, respuesta.json)
            publicados.append(respuesta.json["vehiculo"])

        lector = self.app.test_client()
        combinado = lector.get("/api/vehiculos", query_string={
            "q": "nissan zquery", "disponibilidad": "disponible",
            "precio_min": "12000", "precio_max": "15000",
            "anio_min": "2020", "anio_max": "2021", "tipo_vehiculo": "suv",
        })
        self.assertEqual(combinado.status_code, 200, combinado.json)
        self.assertEqual(
            [vehiculo["id"] for vehiculo in combinado.json["vehiculos"]],
            [publicados[0]["id"], publicados[1]["id"]],
        )
        self.assertNotIn("placa", combinado.json["vehiculos"][0])

        ordenado = lector.get("/api/vehiculos", query_string={
            "q": "nissan zquery", "tipo_vehiculo": "SUV", "orden": "precio_desc",
        })
        self.assertEqual(
            [vehiculo["id"] for vehiculo in ordenado.json["vehiculos"]],
            [publicados[1]["id"], publicados[2]["id"], publicados[3]["id"], publicados[0]["id"]],
        )

        identificador = publicados[0]["id"]
        detalle = lector.get(f"/api/vehiculos/{identificador}")
        self.assertEqual(detalle.status_code, 200)
        self.assertNotIn("placa", detalle.json["vehiculo"])
        self.assertIn("fotografias", detalle.json["vehiculo"])
        pagina = lector.get(f"/vehiculo/{identificador}")
        self.assertEqual(pagina.status_code, 200)
        self.assertIn(f'data-vehiculo-id="{identificador}"'.encode(), pagina.data)

    def test_fotos_reintento_sustitucion_borrado_y_fallo_storage(self):
        self.entrar()
        identificador = self.crear()
        clave = str(uuid.uuid4())
        alta = self.subir(identificador, clave=clave)
        self.assertEqual(alta.status_code, 201, alta.json)
        foto = alta.json["fotografia"]
        original = foto["storage_path"]
        with Image.open(BytesIO(self.storage.objetos[original])) as imagen:
            self.assertEqual(imagen.format, "WEBP")
            self.assertLessEqual(max(imagen.size), 1600)
        self.assertEqual(self.subir(identificador, clave=clave).json["fotografia"]["id"], foto["id"])
        self.assertEqual(len(self.storage.objetos), 1)
        editada = self.cliente.put(f"/api/vehiculos/{identificador}", json={"vehiculo": formulario(modelo="Conserva foto")}, headers=self.headers())
        self.assertEqual(editada.json["vehiculo"]["fotografias"][0]["id"], foto["id"])
        self.storage.fallar_subida = True
        fallida = self.subir(identificador, png("red"), foto_id=foto["id"])
        self.assertEqual(fallida.status_code, 503)
        self.assertEqual(persistencia_fotos.listar_fotografias(identificador)[0]["storage_path"], original)
        self.storage.fallar_subida = False
        self.storage.fallar_borrado = True
        reemplazo = self.subir(identificador, png("green"), foto_id=foto["id"])
        self.assertEqual(reemplazo.status_code, 200, reemplazo.json)
        self.assertTrue(reemplazo.json["limpieza_pendiente"])
        self.assertIn(original, self.storage.objetos)
        nueva_ruta = reemplazo.json["fotografia"]["storage_path"]
        self.assertNotEqual(nueva_ruta, original)
        borrada = self.cliente.delete(f"/api/vehiculos/{identificador}/fotografias/{foto['id']}", headers=self.headers())
        self.assertEqual(borrada.status_code, 200)
        self.assertEqual(borrada.json["fotografias"], [])
        self.assertTrue(borrada.json["limpieza_pendiente"])
        previo = almacenamiento.limpiar_pendientes(proveedor=self.storage)
        self.assertEqual(previo["eliminados"], 0)
        self.storage.fallar_borrado = False
        # Los fallos conservan una concesión de dos minutos. Adelantamos solo
        # ese reloj de la base UUID desechable, sin esperar ni tocar el remoto.
        with persistencia._conectar() as conexion:
            conexion.execute("UPDATE public.storage_limpieza SET reclamada_hasta = clock_timestamp() - interval '1 second'")
        limpieza = almacenamiento.limpiar_pendientes(aplicar=True, proveedor=self.storage)
        self.assertEqual(limpieza["fallidos"], 0)
        self.assertNotIn(original, self.storage.objetos)
        self.assertNotIn(nueva_ruta, self.storage.objetos)
        self.assertFalse(self.storage.borrado_inseguro)

    def test_fallo_postgres_despues_subida_reintenta_sin_referencia_invalida(self):
        self.entrar()
        identificador = self.crear()
        clave = str(uuid.uuid4())
        with patch.object(persistencia_fotos, "guardar_fotografia", side_effect=RuntimeError("detalle-interno-no-publico")):
            fallida = self.subir(identificador, clave=clave)
        self.assertEqual(fallida.status_code, 503)
        self.assertNotIn("detalle-interno", str(fallida.json))
        self.assertEqual(persistencia_fotos.listar_fotografias(identificador), [])
        self.assertEqual(len(self.storage.objetos), 1)
        reintento = self.subir(identificador, clave=clave)
        self.assertEqual(reintento.status_code, 201, reintento.json)
        self.assertEqual(len(reintento.json["fotografias"]), 1)
        self.assertEqual(len(self.storage.objetos), 1)

    def test_intentos_persisten_al_cambiar_cookies_y_no_calculan_hash_bloqueado(self):
        for _ in range(5):
            cliente = self.app.test_client()
            cliente.get("/")
            respuesta = cliente.post("/api/admin/login", json={"password": "incorrecta"}, headers={"X-CSRF-Token": self.csrf(cliente)})
            self.assertEqual(respuesta.status_code, 401)
        cliente = self.app.test_client()
        cliente.get("/")
        with patch("app.check_password_hash") as verificador:
            bloqueada = cliente.post("/api/admin/login", json={"password": "acceso-test-integral"}, headers={"X-CSRF-Token": self.csrf(cliente)})
        self.assertEqual(bloqueada.status_code, 429)
        verificador.assert_not_called()
        self.assertGreater(int(bloqueada.headers["Retry-After"]), 0)


if __name__ == "__main__":
    unittest.main()
