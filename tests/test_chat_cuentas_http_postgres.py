"""Recorrido HTTP multiusuario V7.3.3 sobre PostgreSQL 17 desechable."""

import os
import unittest
import uuid

import psycopg

import cuentas
import persistencia
import propiedad
import roles_usuarios
from app import create_app
from auth_proveedor import ErrorAuth
from test_postgres_integracion import base_aislada, datos


class AuthDoble:
    def __init__(self, usuarios):
        self.usuarios = usuarios

    def usuario(self, token):
        if token not in self.usuarios:
            raise ErrorAuth()
        return self.usuarios[token]

    def salir(self, _token):
        return {}


@unittest.skipUnless(os.environ.get("TEST_DATABASE_URL"), "Requiere PostgreSQL 17 local aislado en TEST_DATABASE_URL")
class ChatCuentasHttpPostgresTest(unittest.TestCase):
    def test_recorrido_privado_comprador_vendedor_sesiones_y_publicacion_retirada(self):
        with base_aislada() as dsn:
            ids = {key: str(uuid.uuid4()) for key in ("buyer_a", "buyer_b", "seller_a", "seller_b")}
            for name, role in (("buyer_a", "comprador"), ("buyer_b", "comprador"),
                               ("seller_a", "vendedor"), ("seller_b", "vendedor")):
                roles_usuarios.asignar_rol_inicial(ids[name], role)
            tokens = {f"token-{name}": {"id": user_id, "email": f"{name}@example.test"}
                      for name, user_id in ids.items()}
            auth = AuthDoble(tokens)
            app = create_app({
                "TESTING": True, "SECRET_KEY": "v733-local-only", "USER_AUTH_ENABLED": True,
                "APP_READ_ONLY": False, "SESSION_COOKIE_SECURE": False,
                "CUENTA_AUTH": auth,
            })

            def login(name):
                client = app.test_client()
                client.get("/cuenta")
                with client.session_transaction() as flask_session:
                    csrf = flask_session["csrf_token"]
                sid = str(uuid.uuid4())
                cuentas.guardar_sesion(ids[name], cuentas.digest(sid))
                client.set_cookie("cuenta_sid", sid)
                client.set_cookie("cuenta_access", f"token-{name}")
                return client, csrf

            sellers = {}
            vehicles = {}
            for name, model in (("seller_a", "V7 comprador A"), ("seller_b", "V7 comprador B")):
                context = propiedad.vendedor.set(ids[name])
                try:
                    record = datos(model)
                    record["marca"] = "Vehículo de prueba"
                    vehicles[name] = persistencia.crear_vehiculo(record)
                finally:
                    propiedad.vendedor.reset(context)
                sellers[name] = login(name)

            buyer_a, csrf_a = login("buyer_a")
            buyer_b, csrf_b = login("buyer_b")
            vehicle_id = vehicles["seller_a"]["id"]
            post_url = f"/api/cuenta/chat/comprador/vehiculos/{vehicle_id}/mensajes"
            key = str(uuid.uuid4())
            headers = {"X-CSRF-Token": csrf_a, "Idempotency-Key": key}
            first = buyer_a.post(post_url, json={"contenido": "¿Sigue disponible?"}, headers=headers)
            retry = buyer_a.post(post_url, json={"contenido": "¿Sigue disponible?"}, headers=headers)
            self.assertEqual(first.status_code, 201, first.json)
            self.assertEqual(retry.status_code, 200, retry.json)
            self.assertTrue(retry.json["duplicado"])
            conversation_id = first.json["conversacion"]["id"]

            inbox_a = sellers["seller_a"][0].get("/api/cuenta/chat/vendedor/conversaciones")
            inbox_b = sellers["seller_b"][0].get("/api/cuenta/chat/vendedor/conversaciones")
            self.assertEqual([row["id"] for row in inbox_a.json["conversaciones"]], [conversation_id])
            self.assertEqual(inbox_b.json["conversaciones"], [])
            thread_url = f"/api/cuenta/chat/vendedor/conversaciones/{conversation_id}/mensajes"
            self.assertEqual(sellers["seller_b"][0].get(thread_url).status_code, 404)
            self.assertEqual(buyer_b.get(
                f"/api/cuenta/chat/comprador/conversaciones/{conversation_id}/mensajes",
            ).status_code, 404)

            seller_a, seller_csrf = sellers["seller_a"]
            answer = seller_a.post(thread_url, json={"contenido": "Sí, continúa disponible."}, headers={
                "X-CSRF-Token": seller_csrf, "Idempotency-Key": str(uuid.uuid4()),
            })
            self.assertEqual(answer.status_code, 201, answer.json)
            self.assertEqual(sellers["seller_b"][0].post(thread_url, json={"contenido": "Intrusión"}, headers={
                "X-CSRF-Token": sellers["seller_b"][1], "Idempotency-Key": str(uuid.uuid4()),
            }).status_code, 404)

            buyer_a_relogin, buyer_a_relogin_csrf = login("buyer_a")
            list_response = buyer_a_relogin.get("/api/cuenta/chat/comprador/conversaciones")
            self.assertEqual(list_response.status_code, 200)
            self.assertEqual([row["id"] for row in list_response.json["conversaciones"]], [conversation_id])
            buyer_thread = buyer_a_relogin.get(
                f"/api/cuenta/chat/comprador/conversaciones/{conversation_id}/mensajes",
            )
            self.assertEqual([row["contenido"] for row in buyer_thread.json["mensajes"]], [
                "¿Sigue disponible?", "Sí, continúa disponible.",
            ])
            self.assertEqual(buyer_a.post("/api/cuenta/logout", headers={"X-CSRF-Token": csrf_a},
                                         json={}).status_code, 200)
            after_logout = buyer_a.get("/api/cuenta/chat/comprador/conversaciones")
            self.assertEqual(after_logout.status_code, 401)
            self.assertNotIn("¿Sigue disponible?", after_logout.get_data(as_text=True))

            seller_vehicle = vehicles["seller_a"]
            owner_context = propiedad.vendedor.set(ids["seller_a"])
            try:
                retired = persistencia.retirar_vehiculo(seller_vehicle["id"], seller_vehicle["updated_at"])
            finally:
                propiedad.vendedor.reset(owner_context)
            self.assertEqual(retired, "retirado")
            retired_history = buyer_a_relogin.get(
                f"/api/cuenta/chat/comprador/conversaciones/{conversation_id}/mensajes",
            )
            self.assertEqual(retired_history.status_code, 200)
            self.assertEqual(len(retired_history.json["mensajes"]), 2)
            self.assertEqual(buyer_a_relogin.post(
                post_url, json={"contenido": "Nuevo mensaje tras retirar"}, headers={
                    "X-CSRF-Token": buyer_a_relogin_csrf,
                    "Idempotency-Key": str(uuid.uuid4()),
                },
            ).status_code, 404)
            self.assertEqual(seller_a.post(thread_url, json={"contenido": "Nueva respuesta"}, headers={
                "X-CSRF-Token": seller_csrf, "Idempotency-Key": str(uuid.uuid4()),
            }).status_code, 409)

            with psycopg.connect(dsn) as db:
                self.assertEqual(db.execute(
                    "SELECT count(*) FROM public.mensajes_chat_cuentas WHERE conversacion_id = %s",
                    (conversation_id,),
                ).fetchone()[0], 2)
