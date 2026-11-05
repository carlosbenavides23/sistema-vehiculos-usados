"""Contratos HTTP y controles de acceso del chat con persistencia simulada."""

from datetime import datetime, timedelta, timezone
import hashlib
import uuid
import unittest

from werkzeug.security import generate_password_hash

from app import create_app


def limite_falso():
    return {"reservar_intento_login": lambda *args: 0, "reiniciar_intentos_login": lambda *args: None}


class RepositorioChatFalso:
    def __init__(self):
        self.sesiones = {}
        self.conversaciones = {}
        self.mensajes = {}
        self.claves = {}
        self.vehiculos = {1: {"id": 1, "marca": "Toyota", "modelo": "Corolla", "anio": 2021}}

    def crear_visitante_y_sesion(self, verificador, expira):
        visitante_id, sesion_id = str(uuid.uuid4()), str(uuid.uuid4())
        self.sesiones[verificador] = {"visitante_id": visitante_id, "sesion_id": sesion_id, "expires_at": expira}
        return {"visitante_id": visitante_id, "sesion_id": sesion_id}

    def resolver_visitante(self, verificador):
        datos = self.sesiones.get(verificador)
        if not datos or datos["expires_at"] <= datetime.now(timezone.utc):
            return None
        return datos

    def revocar_sesion_visitante(self, verificador):
        return self.sesiones.pop(verificador, None) is not None

    def listar_conversaciones_visitante(self, visitante_id):
        return [c for c in self.conversaciones.values() if c["visitante_id"] == visitante_id]

    def enviar_mensaje_comprador(self, visitante_id, vehiculo_id, clave, huella, contenido):
        existente = self.claves.get(str(clave))
        if existente:
            if existente["huella"] != huella or existente["visitante_id"] != visitante_id:
                raise ValueError("Clave idempotente reutilizada")
            return {"conversacion": self.conversaciones[existente["conversacion_id"]], "mensaje": existente["mensaje"], "duplicado": True}
        vehiculo = self.vehiculos.get(vehiculo_id)
        if not vehiculo:
            return None
        conversacion = next((c for c in self.conversaciones.values() if c["visitante_id"] == visitante_id and c["vehiculo_id"] == vehiculo_id), None)
        if not conversacion:
            conversacion = {"id": str(uuid.uuid4()), "visitante_id": visitante_id, "vehiculo_id": vehiculo_id, "marca": vehiculo["marca"], "modelo": vehiculo["modelo"], "estado": "abierta"}
            self.conversaciones[conversacion["id"]] = conversacion
            self.mensajes[conversacion["id"]] = []
        mensaje = {"id": len(self.mensajes[conversacion["id"]]) + 1, "conversacion_id": conversacion["id"], "remitente": "comprador", "contenido": contenido, "created_at": datetime.now(timezone.utc).isoformat()}
        self.mensajes[conversacion["id"]].append(mensaje)
        self.claves[str(clave)] = {"huella": huella, "visitante_id": visitante_id, "conversacion_id": conversacion["id"], "mensaje": mensaje}
        return {"conversacion": conversacion, "mensaje": mensaje, "duplicado": False}

    def listar_mensajes(self, conversacion_id, despues_de_id=0, visitante_id=None, admin=False):
        conversacion = self.conversaciones.get(str(conversacion_id))
        if not conversacion or (not admin and conversacion["visitante_id"] != visitante_id):
            return None
        return [m for m in self.mensajes[str(conversacion_id)] if m["id"] > despues_de_id]

    def listar_conversaciones_admin(self, estado=None, cursor_id=None, limite=50):
        items = list(self.conversaciones.values())
        return [c for c in items if estado is None or c["estado"] == estado][:limite]

    def responder_admin(self, conversacion_id, clave, huella, contenido):
        conversacion = self.conversaciones.get(str(conversacion_id))
        if not conversacion:
            return None
        existente = self.claves.get(str(clave))
        if existente:
            if existente["huella"] != huella:
                raise ValueError("Clave idempotente reutilizada")
            return {"mensaje": existente["mensaje"], "duplicado": True}
        mensaje = {"id": len(self.mensajes[str(conversacion_id)]) + 1, "conversacion_id": str(conversacion_id), "remitente": "administrador", "contenido": contenido, "created_at": datetime.now(timezone.utc).isoformat()}
        self.mensajes[str(conversacion_id)].append(mensaje)
        self.claves[str(clave)] = {"huella": huella, "mensaje": mensaje}
        return {"mensaje": mensaje, "duplicado": False}

    def marcar_atendida(self, conversacion_id):
        conversacion = self.conversaciones.get(str(conversacion_id))
        if conversacion:
            conversacion["estado"] = "atendida"
        return conversacion


class ChatApiTest(unittest.TestCase):
    def setUp(self):
        self.repo = RepositorioChatFalso()
        self.app = create_app({
            "TESTING": True,
            "SECRET_KEY": "clave-pruebas-chat",
            "ADMIN_PASSWORD_HASH": generate_password_hash("clave-admin"),
            "SESSION_COOKIE_SECURE": False,
            "APP_READ_ONLY": False,
            "CHAT_ENABLED": True,
            "CHAT_REPOSITORY": self.repo.__dict__,
            "LOGIN_LIMITER": limite_falso(),
        })
        # Flask espera un mapa de funciones, no atributos ligados de la instancia.
        self.app.config["CHAT_REPOSITORY"] = {
            nombre: getattr(self.repo, nombre) for nombre in (
                "crear_visitante_y_sesion", "resolver_visitante", "revocar_sesion_visitante",
                "listar_conversaciones_visitante", "enviar_mensaje_comprador", "listar_mensajes",
                "listar_conversaciones_admin", "responder_admin", "marcar_atendida",
            )
        }
        self.cliente = self.app.test_client()
        self.cliente.get("/")

    def csrf_admin(self):
        with self.cliente.session_transaction() as sesion:
            return sesion["csrf_token"]

    def crear_sesion_chat(self, cliente=None):
        cliente = cliente or self.cliente
        pagina = cliente.get("/")
        import re
        csrf = re.search(rb'<meta name="csrf-token" content="([^"]+)', pagina.data).group(1).decode()
        respuesta = cliente.post("/api/chat/sesion", headers={"X-CSRF-Token": csrf})
        self.assertEqual(respuesta.status_code, 201, respuesta.get_data(as_text=True))
        return respuesta.json["csrf_token"]

    def test_chat_desactivado_por_defecto_y_preview_no_se_puede_habilitar(self):
        base = {"SECRET_KEY": "test", "TESTING": True, "APP_READ_ONLY": False, "CHAT_REPOSITORY": {}}
        app = create_app(base)
        self.assertEqual(app.test_client().post("/api/chat/sesion").status_code, 503)
        # En Preview el flag solicitado no prevalece sobre el modo solo lectura.
        import os
        anterior = os.environ.get("VERCEL_ENV")
        try:
            os.environ["VERCEL_ENV"] = "preview"
            preview = create_app({**base, "CHAT_ENABLED": True})
        finally:
            if anterior is None:
                os.environ.pop("VERCEL_ENV", None)
            else:
                os.environ["VERCEL_ENV"] = anterior
        self.assertFalse(preview.config["CHAT_ENABLED"])
        self.assertEqual(preview.test_client().get("/api/chat/conversaciones").status_code, 503)

    def test_crea_credencial_servidor_cookie_segura_sin_exponerla_y_csrf(self):
        sin_csrf = self.cliente.post("/api/chat/sesion")
        self.assertEqual(sin_csrf.status_code, 403)
        csrf = self.crear_sesion_chat()
        respuesta = self.cliente.post("/api/chat/sesion", headers={"X-CSRF-Token": self.csrf_admin()})
        self.assertEqual(respuesta.status_code, 200)
        self.assertNotIn("token", respuesta.json)
        cookie = next(c for c in self.cliente._cookies.values() if c.key == "chat_session")
        self.assertTrue(cookie.http_only)
        self.assertEqual(cookie.same_site, "Lax")
        self.assertEqual(len(cookie.value), 43)
        self.assertEqual(len(self.repo.sesiones), 1)
        self.assertNotIn(cookie.value, next(iter(self.repo.sesiones.keys())))
        self.assertEqual(len(csrf), 64)
        self.assertEqual(self.repo.conversaciones, {})

    def test_mensaje_persistido_reintento_idempotente_y_cursor(self):
        csrf = self.crear_sesion_chat()
        clave = str(uuid.uuid4())
        h = {"X-CSRF-Token": csrf, "Idempotency-Key": clave}
        first = self.cliente.post("/api/chat/vehiculos/1/mensajes", json={"contenido": "Hola vendedor"}, headers=h)
        second = self.cliente.post("/api/chat/vehiculos/1/mensajes", json={"contenido": "Hola vendedor"}, headers=h)
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertTrue(second.json["duplicado"])
        conv = first.json["conversacion"]["id"]
        batch = self.cliente.get(f"/api/chat/conversaciones/{conv}/mensajes?despues_de_id=0")
        self.assertEqual(len(batch.json["mensajes"]), 1)
        later = self.cliente.get(f"/api/chat/conversaciones/{conv}/mensajes?despues_de_id=1")
        self.assertEqual(later.json["mensajes"], [])

    def test_buyer_b_no_puede_abrir_conversacion_de_buyer_a(self):
        csrf_a = self.crear_sesion_chat()
        enviado = self.cliente.post("/api/chat/vehiculos/1/mensajes", json={"contenido": "Consulta A"}, headers={"X-CSRF-Token": csrf_a, "Idempotency-Key": str(uuid.uuid4())})
        conversacion = enviado.json["conversacion"]["id"]
        buyer_b = self.app.test_client()
        csrf_b = self.crear_sesion_chat(buyer_b)
        acceso = buyer_b.get(f"/api/chat/conversaciones/{conversacion}/mensajes")
        self.assertEqual(acceso.status_code, 404)
        self.assertIn("conversación", acceso.json["mensaje"])
        self.assertEqual(self.repo.listar_conversaciones_visitante(next(iter(self.repo.sesiones.values()))["visitante_id"]), [enviado.json["conversacion"]])

    def test_validacion_longitud_y_csrf_en_envio(self):
        csrf = self.crear_sesion_chat()
        ruta = "/api/chat/vehiculos/1/mensajes"
        key = str(uuid.uuid4())
        self.assertEqual(self.cliente.post(ruta, json={"contenido": "  "}, headers={"X-CSRF-Token": csrf, "Idempotency-Key": key}).status_code, 422)
        self.assertEqual(self.cliente.post(ruta, json={"contenido": "x" * 2001}, headers={"X-CSRF-Token": csrf, "Idempotency-Key": key}).status_code, 422)
        self.assertEqual(self.cliente.post(ruta, json={"contenido": "hola"}, headers={"Idempotency-Key": str(uuid.uuid4())}).status_code, 403)

    def test_sesion_desconocida_no_se_acepta(self):
        cliente = self.app.test_client()
        with cliente.session_transaction() as sesion:
            sesion["csrf_token"] = "token-csrf"
        cliente.set_cookie("chat_session", "credencial-ajena-no-reconocida")
        respuesta = cliente.get("/api/chat/conversaciones")
        self.assertEqual(respuesta.status_code, 401)
        self.assertEqual(len(self.repo.sesiones), 0)

    def test_admin_requiere_sesion_y_csrf_para_responder_y_atender(self):
        csrf = self.crear_sesion_chat()
        mensaje = self.cliente.post("/api/chat/vehiculos/1/mensajes", json={"contenido": "¿Está disponible?"}, headers={"X-CSRF-Token": csrf, "Idempotency-Key": str(uuid.uuid4())})
        conv = mensaje.json["conversacion"]["id"]
        url = f"/api/admin/chat/conversaciones/{conv}/mensajes"
        self.assertEqual(self.cliente.post(url, json={"contenido": "Sí"}, headers={"Idempotency-Key": str(uuid.uuid4())}).status_code, 401)
        login = self.cliente.post("/api/admin/login", json={"password": "clave-admin"}, headers={"X-CSRF-Token": self.csrf_admin()})
        self.assertEqual(login.status_code, 200)
        token_admin = login.json["csrf_token"]
        response = self.cliente.post(url, json={"contenido": "Sí"}, headers={"X-CSRF-Token": token_admin, "Idempotency-Key": str(uuid.uuid4())})
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True))
        self.assertEqual(self.cliente.patch(f"/api/admin/chat/conversaciones/{conv}/atendida", json={}, headers={"X-CSRF-Token": token_admin}).status_code, 200)

    def test_respuesta_admin_se_recibe_en_poll_del_comprador(self):
        csrf = self.crear_sesion_chat()
        original = self.cliente.post("/api/chat/vehiculos/1/mensajes", json={"contenido": "Consulta"}, headers={"X-CSRF-Token": csrf, "Idempotency-Key": str(uuid.uuid4())})
        conv = original.json["conversacion"]["id"]
        login = self.cliente.post("/api/admin/login", json={"password": "clave-admin"}, headers={"X-CSRF-Token": self.csrf_admin()})
        respuesta = self.cliente.post(f"/api/admin/chat/conversaciones/{conv}/mensajes", json={"contenido": "Sí, disponible"}, headers={"X-CSRF-Token": login.json["csrf_token"], "Idempotency-Key": str(uuid.uuid4())})
        self.assertEqual(respuesta.status_code, 201)
        recibidos = self.cliente.get(f"/api/chat/conversaciones/{conv}/mensajes?despues_de_id=1")
        self.assertEqual(recibidos.status_code, 200)
        self.assertEqual([m["contenido"] for m in recibidos.json["mensajes"]], ["Sí, disponible"])

    def test_sesion_expirada_es_rechazada(self):
        self.crear_sesion_chat()
        clave = next(iter(self.repo.sesiones))
        self.repo.sesiones[clave]["expires_at"] = datetime.now(timezone.utc) - timedelta(seconds=1)
        respuesta = self.cliente.get("/api/chat/conversaciones")
        self.assertEqual(respuesta.status_code, 401)


if __name__ == "__main__":
    unittest.main()
