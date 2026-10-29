"""Pruebas HTTP con un repositorio en memoria; no son integración PostgreSQL."""

import os
import unittest
from unittest.mock import patch
from uuid import uuid4

os.environ.setdefault("FLASK_SECRET_KEY", "clave-solo-para-pruebas")

import app as app_module  # noqa: E402
from app import MAX_PASSWORD_LENGTH, create_app  # noqa: E402
from test_vehiculos import formulario
from werkzeug.security import generate_password_hash  # noqa: E402


def repositorio_falso():
    filas = []
    siguiente_id = [1]
    solicitudes = {}

    def lista():
        return [dict(fila) for fila in filas]

    def obtener(identificador):
        return next((dict(fila) for fila in filas if fila["id"] == identificador), None)

    def crear(datos):
        if len(filas) >= 500:
            return None
        fila = {
            "id": siguiente_id[0], **datos,
            "created_at": "2026-10-29T12:00:00+00:00",
            "updated_at": "2026-10-29T12:00:00+00:00",
        }
        siguiente_id[0] += 1
        filas.append(fila)
        return dict(fila)

    def editar(identificador, datos):
        fila = next((fila for fila in filas if fila["id"] == identificador), None)
        if fila is None:
            return None
        fila.update(datos)
        fila["updated_at"] = "2026-10-29T13:00:00+00:00"
        return dict(fila)

    def disponibilidad(identificador, valor):
        fila = next((fila for fila in filas if fila["id"] == identificador), None)
        if fila is None:
            return None
        fila["disponibilidad"] = valor
        return dict(fila)

    def crear_idempotente(datos, clave):
        if clave in solicitudes:
            anteriores, identificador = solicitudes[clave]
            if anteriores != datos:
                raise ValueError("Solicitud incompatible.")
            return obtener(identificador)
        fila = crear(datos)
        if fila is not None:
            solicitudes[clave] = (dict(datos), fila["id"])
        return fila

    return {
        "listar_vehiculos": lista,
        "obtener_vehiculo": obtener,
        "crear_vehiculo": crear,
        "crear_vehiculo_idempotente": crear_idempotente,
        "editar_vehiculo": editar,
        "cambiar_disponibilidad": disponibilidad,
    }


def limite_falso():
    """Doble unitario compartido por clientes; nunca se usa en producción."""
    intentos = {}

    def reservar(clave, maximo, ventana):
        cantidad = intentos.get(clave, 0)
        if cantidad >= maximo:
            return ventana
        intentos[clave] = cantidad + 1
        return 0

    return {"reservar_intento_login": reservar, "reiniciar_intentos_login": lambda clave: intentos.pop(clave, None)}


def fotos_vacias():
    return {"listar_por_vehiculos": lambda ids: {identificador: [] for identificador in ids}, "listar_fotografias": lambda identificador: []}


class ApiPostgresContractTest(unittest.TestCase):
    def setUp(self):
        self.repo = repositorio_falso()
        self.app = create_app({
            "TESTING": True,
            "SECRET_KEY": "clave-solo-para-pruebas",
            "ADMIN_PASSWORD_HASH": generate_password_hash("clave-del-grupo"),
            "SESSION_COOKIE_SECURE": False,
            "REPOSITORY": self.repo,
            "PHOTO_REPOSITORY": fotos_vacias(),
            "LOGIN_LIMITER": limite_falso(),
            "APP_READ_ONLY": False,
        })
        self.cliente = self.app.test_client()
        self.cliente.get("/")

    def token(self):
        with self.cliente.session_transaction() as sesion:
            return sesion["csrf_token"]

    def iniciar_admin(self):
        respuesta = self.cliente.post(
            "/api/admin/login", json={"password": "clave-del-grupo"},
            headers={"X-CSRF-Token": self.token()},
        )
        self.assertEqual(respuesta.status_code, 200)
        return respuesta

    def test_catalogo_publico_y_consulta_individual(self):
        lista_vacia = self.cliente.get("/api/vehiculos")
        self.assertEqual(lista_vacia.status_code, 200)
        self.assertEqual(lista_vacia.json, {"ok": True, "vehiculos": []})
        self.iniciar_admin()
        creado = self.cliente.post(
            "/api/vehiculos", json={"vehiculo": formulario(placa="M 123-456")},
            headers={"X-CSRF-Token": self.token(), "Idempotency-Key": str(uuid4())},
        )
        self.assertEqual(creado.status_code, 201)
        self.assertEqual(creado.json["vehiculo"]["id"], 1)
        lector_publico = self.app.test_client()
        publico = lector_publico.get("/api/vehiculos")
        self.assertNotIn("placa", publico.json["vehiculos"][0])
        self.assertEqual(publico.headers.get("Cache-Control"), "no-store")
        privado = self.cliente.get("/api/vehiculos/1")
        self.assertEqual(privado.json["vehiculo"]["placa"], "M 123-456")
        self.assertEqual(privado.headers.get("Cache-Control"), "no-store")
        self.assertEqual(self.cliente.get("/api/vehiculos/99").status_code, 404)

    def test_operaciones_por_registro_edicion_y_disponibilidad(self):
        self.iniciar_admin()
        headers = {"X-CSRF-Token": self.token(), "Idempotency-Key": str(uuid4())}
        creado = self.cliente.post("/api/vehiculos", json={"vehiculo": formulario()}, headers=headers)
        self.assertEqual(creado.status_code, 201)
        identificador = creado.json["vehiculo"]["id"]
        editado = self.cliente.put(
            f"/api/vehiculos/{identificador}", json={"vehiculo": formulario(modelo="Yaris")},
            headers={"X-CSRF-Token": self.token()},
        )
        self.assertEqual(editado.status_code, 200)
        self.assertEqual(editado.json["vehiculo"]["modelo"], "Yaris")
        self.assertEqual(editado.json["vehiculo"]["id"], identificador)
        cambiado = self.cliente.patch(
            f"/api/vehiculos/{identificador}/disponibilidad", json={"disponibilidad": "vendido"},
            headers={"X-CSRF-Token": self.token()},
        )
        self.assertEqual(cambiado.json["vehiculo"]["disponibilidad"], "vendido")
        self.assertEqual(self.cliente.put("/api/vehiculos/99", json={"vehiculo": formulario()}, headers={"X-CSRF-Token": self.token()}).status_code, 404)

    def test_escrituras_requieren_sesion_y_csrf(self):
        sin_sesion = self.cliente.post("/api/vehiculos", json={"vehiculo": formulario()}, headers={"X-CSRF-Token": self.token()})
        self.assertEqual(sin_sesion.status_code, 401)
        self.iniciar_admin()
        sin_csrf = self.cliente.post("/api/vehiculos", json={"vehiculo": formulario()})
        self.assertEqual(sin_csrf.status_code, 403)
        token_invalido = self.cliente.post("/api/vehiculos", json={"vehiculo": formulario()}, headers={"X-CSRF-Token": "no-es-el-token"})
        self.assertEqual(token_invalido.status_code, 403)

    def test_login_hash_cookie_csrf_y_logout(self):
        token_anterior = self.token()
        login = self.cliente.post(
            "/api/admin/login", json={"password": "clave-del-grupo"},
            headers={"X-CSRF-Token": token_anterior},
        )
        self.assertTrue(login.json["autenticado"])
        self.assertNotEqual(login.json["csrf_token"], token_anterior)
        self.assertTrue(self.cliente.get("/api/admin/session").json["autenticado"])
        salir = self.cliente.post(
            "/api/admin/logout", json={},
            headers={"X-CSRF-Token": login.json["csrf_token"]},
        )
        self.assertFalse(salir.json["autenticado"])
        self.assertFalse(self.cliente.get("/api/admin/session").json["autenticado"])
        self.assertEqual(self.cliente.post("/api/admin/logout", json={}, headers={"X-CSRF-Token": token_anterior}).status_code, 403)

    def test_intentos_fallidos_bloquean_aunque_se_cambie_de_cookie(self):
        for _ in range(5):
            respuesta = self.cliente.post(
                "/api/admin/login", json={"password": "incorrecta"},
                headers={"X-CSRF-Token": self.token()},
            )
            self.assertEqual(respuesta.status_code, 401)
        otro_cliente = self.app.test_client()
        otro_cliente.get("/")
        with otro_cliente.session_transaction() as sesion:
            nuevo_token = sesion["csrf_token"]
        bloqueada = otro_cliente.post(
            "/api/admin/login", json={"password": "clave-del-grupo"},
            headers={"X-CSRF-Token": nuevo_token},
        )
        self.assertEqual(bloqueada.status_code, 429)
        self.assertIn("Retry-After", bloqueada.headers)

    def test_login_rechaza_contrasena_larga_sin_calcular_hash(self):
        password_larga = "x" * (MAX_PASSWORD_LENGTH + 1)
        with patch.object(app_module, "check_password_hash") as verificar_hash:
            respuesta = self.cliente.post(
                "/api/admin/login", json={"password": password_larga},
                headers={"X-CSRF-Token": self.token()},
            )
        self.assertEqual(respuesta.status_code, 400)
        self.assertIn("password", respuesta.json["errores"])
        verificar_hash.assert_not_called()

    def test_alta_repetida_es_idempotente_y_reuso_distinto_se_rechaza(self):
        self.iniciar_admin()
        headers = {"X-CSRF-Token": self.token(), "Idempotency-Key": str(uuid4())}
        primero = self.cliente.post("/api/vehiculos", json={"vehiculo": formulario()}, headers=headers)
        repetido = self.cliente.post("/api/vehiculos", json={"vehiculo": formulario()}, headers=headers)
        self.assertEqual(primero.status_code, 201)
        self.assertEqual(repetido.json["vehiculo"]["id"], primero.json["vehiculo"]["id"])
        self.assertEqual(len(self.repo["listar_vehiculos"]()), 1)
        distinto = self.cliente.post("/api/vehiculos", json={"vehiculo": formulario(modelo="Otro")}, headers=headers)
        self.assertEqual(distinto.status_code, 409)

    def test_fallo_del_limite_persistente_no_permite_login(self):
        def falla(*args):
            raise RuntimeError("dato-interno-del-servidor")
        self.app.config["LOGIN_LIMITER"] = {"reservar_intento_login": falla}
        with patch.object(app_module, "check_password_hash") as verificar_hash:
            respuesta = self.cliente.post("/api/admin/login", json={"password": "clave-del-grupo"}, headers={"X-CSRF-Token": self.token()})
        self.assertEqual(respuesta.status_code, 503)
        self.assertNotIn("dato-interno", respuesta.get_data(as_text=True))
        verificar_hash.assert_not_called()

    def test_solo_lectura_conserva_catalogo_y_rechaza_login(self):
        self.app.config["APP_READ_ONLY"] = True
        self.assertEqual(self.cliente.get("/api/vehiculos").status_code, 200)
        self.assertTrue(self.cliente.get("/api/admin/session").json["solo_lectura"])
        login = self.cliente.post("/api/admin/login", json={"password": "clave-del-grupo"}, headers={"X-CSRF-Token": self.token()})
        self.assertEqual(login.status_code, 503)

    def test_preview_siempre_es_solo_lectura_aunque_se_pida_desbloquear(self):
        with patch.dict(os.environ, {"VERCEL_ENV": "preview", "APP_READ_ONLY": "false", "DATABASE_URL": "postgresql://postgres.rtcygltmrtulyeezaaac:secreto@pooler.test/postgres", "SUPABASE_URL": "https://rtcygltmrtulyeezaaac.supabase.co"}):
            self.assertTrue(app_module._solo_lectura_desde_entorno())
        with patch.dict(os.environ, {"VERCEL_ENV": "preview", "APP_READ_ONLY": "false", "DATABASE_URL": "postgresql://postgres.abcdefghijklmnopqrst:secreto@pooler.test/postgres", "SUPABASE_URL": "https://abcdefghijklmnopqrst.supabase.co"}):
            self.assertTrue(app_module._solo_lectura_desde_entorno())

    def test_validacion_de_campos_y_solicitud_json(self):
        self.iniciar_admin()
        invalido = self.cliente.post(
            "/api/vehiculos", json={"vehiculo": formulario(marca=" ")},
            headers={"X-CSRF-Token": self.token(), "Idempotency-Key": str(uuid4())},
        )
        self.assertEqual(invalido.status_code, 422)
        self.assertIn("marca", invalido.json["errores"])
        campos_extra = self.cliente.post(
            "/api/vehiculos", json={"vehiculo": {**formulario(), "id": 8}},
            headers={"X-CSRF-Token": self.token(), "Idempotency-Key": str(uuid4())},
        )
        self.assertEqual(campos_extra.status_code, 422)
        cuerpo_antiguo = self.cliente.post(
            "/api/vehiculos", json={"estado": {"version": 1, "vehiculos": []}, "vehiculo": formulario()},
            headers={"X-CSRF-Token": self.token()},
        )
        self.assertEqual(cuerpo_antiguo.status_code, 400)
        json_invalido = self.cliente.post(
            "/api/vehiculos", data="{", content_type="application/json",
            headers={"X-CSRF-Token": self.token()},
        )
        self.assertEqual(json_invalido.status_code, 400)

    def test_error_postgres_no_expone_detalles(self):
        def falla():
            raise RuntimeError("password=secreto-interno")
        app = create_app({
            "TESTING": True, "SECRET_KEY": "test", "SESSION_COOKIE_SECURE": False,
            "REPOSITORY": {**self.repo, "listar_vehiculos": falla},
        })
        respuesta = app.test_client().get("/api/vehiculos")
        self.assertEqual(respuesta.status_code, 503)
        self.assertNotIn("secreto-interno", respuesta.get_data(as_text=True))


if __name__ == "__main__":
    unittest.main()
