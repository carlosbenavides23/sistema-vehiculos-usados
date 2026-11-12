"""Pruebas HTTP aisladas de V7.3.2 con identidades y repositorio simulados."""

from datetime import datetime, timezone
import hashlib
import os
import re
import uuid
import unittest
from unittest.mock import patch

from app import create_app
import cuentas
import persistencia_chat_cuentas


class AuthFalsa:
    def __init__(self, usuarios):
        self.usuarios = usuarios

    def usuario(self, token):
        usuario = self.usuarios.get(token)
        if usuario is None:
            import auth_proveedor
            raise auth_proveedor.ErrorAuth()
        return usuario

    def renovar(self, token):
        import auth_proveedor
        raise auth_proveedor.ErrorAuth()


class RepositorioCuentasFalso:
    def __init__(self, compradores, vendedores, vehiculos, conversaciones, mensajes):
        self.compradores = compradores
        self.vendedores = vendedores
        self.vehiculos = vehiculos
        self.conversaciones = conversaciones
        self.mensajes = mensajes
        self.sesiones = {}
        self.llamadas = []
        self.claves = {}
        self.limite = False

    def _agregar_llamada(self, nombre, *args):
        self.llamadas.append((nombre, *args))

    @staticmethod
    def _salida_mensaje(mensaje):
        return dict(mensaje)

    def listar_conversaciones_comprador(self, comprador_id, cursor_id=None, limite=50):
        self._agregar_llamada("listar_comprador", comprador_id, cursor_id, limite)
        return [dict(c) for c in self.conversaciones.values() if c["comprador_id"] == comprador_id][:limite]

    def listar_conversaciones_vendedor(self, vendedor_id, cursor_id=None, limite=50):
        self._agregar_llamada("listar_vendedor", vendedor_id, cursor_id, limite)
        return [dict(c) for c in self.conversaciones.values() if c["vendedor_id"] == vendedor_id][:limite]

    def obtener_conversacion_vehiculo_comprador(self, comprador_id, vehiculo_id):
        self._agregar_llamada("obtener_por_vehiculo", comprador_id, vehiculo_id)
        return next((dict(c) for c in self.conversaciones.values()
                     if c["comprador_id"] == comprador_id and c["vehiculo_id"] == vehiculo_id), None)

    def obtener_conversacion_comprador(self, conversacion_id, comprador_id):
        self._agregar_llamada("obtener_comprador", conversacion_id, comprador_id)
        conv = self.conversaciones.get(str(conversacion_id))
        return dict(conv) if conv and conv["comprador_id"] == comprador_id else None

    def obtener_conversacion_vendedor(self, conversacion_id, vendedor_id):
        self._agregar_llamada("obtener_vendedor", conversacion_id, vendedor_id)
        conv = self.conversaciones.get(str(conversacion_id))
        return dict(conv) if conv and conv["vendedor_id"] == vendedor_id else None

    def listar_mensajes_comprador(self, conversacion_id, comprador_id, despues_de_id=0):
        conv = self.obtener_conversacion_comprador(conversacion_id, comprador_id)
        if conv is None:
            return None
        return [dict(m) for m in self.mensajes.get(str(conversacion_id), []) if m["id"] > despues_de_id]

    def listar_mensajes_vendedor(self, conversacion_id, vendedor_id, despues_de_id=0):
        conv = self.obtener_conversacion_vendedor(conversacion_id, vendedor_id)
        if conv is None:
            return None
        return [dict(m) for m in self.mensajes.get(str(conversacion_id), []) if m["id"] > despues_de_id]

    def enviar_mensaje_comprador(self, comprador_id, vehiculo_id, clave, huella, contenido):
        self._agregar_llamada("enviar_comprador", comprador_id, vehiculo_id, clave, huella, contenido)
        if self.limite:
            raise persistencia_chat_cuentas.LimiteMensajesChat(12)
        if str(clave) in self.claves:
            anterior = self.claves[str(clave)]
            if anterior["huella"] != huella or anterior["comprador_id"] != comprador_id or anterior["vehiculo_id"] != vehiculo_id:
                raise ValueError("Clave reutilizada.")
            return {**anterior["resultado"], "duplicado": True}
        vehiculo = self.vehiculos.get(vehiculo_id)
        if not vehiculo or vehiculo["retirado"] or not vehiculo["vendedor_id"]:
            return None
        conversacion = next((c for c in self.conversaciones.values()
                             if c["comprador_id"] == comprador_id and c["vehiculo_id"] == vehiculo_id), None)
        if conversacion is None:
            conversacion = self._nueva_conversacion(comprador_id, vehiculo)
        mensaje = {
            "id": len(self.mensajes.get(conversacion["id"], [])) + 1,
            "conversacion_id": conversacion["id"], "autor_id": comprador_id,
            "remitente": "comprador", "contenido": contenido,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        self.mensajes.setdefault(conversacion["id"], []).append(mensaje)
        resultado = {"conversacion": dict(conversacion), "mensaje": self._salida_mensaje(mensaje), "duplicado": False}
        self.claves[str(clave)] = {"huella": huella, "comprador_id": comprador_id,
                                   "vehiculo_id": vehiculo_id, "resultado": resultado}
        return resultado

    def _nueva_conversacion(self, comprador_id, vehiculo):
        ahora = datetime.now(timezone.utc).isoformat()
        conv = {
            "id": str(uuid.uuid4()), "comprador_id": comprador_id,
            "vendedor_id": vehiculo["vendedor_id"], "vehiculo_id": vehiculo["id"],
            "marca": vehiculo["marca"], "modelo": vehiculo["modelo"], "anio": vehiculo["anio"],
            "estado": "abierta", "created_at": ahora, "updated_at": ahora,
            "vehiculo_retirado": False,
        }
        self.conversaciones[conv["id"]] = conv
        return conv

    def responder_vendedor(self, vendedor_id, conversacion_id, clave, huella, contenido):
        self._agregar_llamada("responder_vendedor", vendedor_id, conversacion_id, clave, huella, contenido)
        conv = self.conversaciones.get(str(conversacion_id))
        if not conv or conv["vendedor_id"] != vendedor_id:
            return None
        if str(clave) in self.claves:
            anterior = self.claves[str(clave)]
            if anterior["huella"] != huella or anterior["vendedor_id"] != vendedor_id:
                raise ValueError("Clave reutilizada.")
            return {"mensaje": anterior["mensaje"], "duplicado": True}
        if conv["vehiculo_retirado"]:
            return None
        mensaje = {
            "id": len(self.mensajes.get(str(conversacion_id), [])) + 1,
            "conversacion_id": str(conversacion_id), "autor_id": vendedor_id,
            "remitente": "vendedor", "contenido": contenido,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        self.mensajes.setdefault(str(conversacion_id), []).append(mensaje)
        self.claves[str(clave)] = {"huella": huella, "vendedor_id": vendedor_id, "mensaje": mensaje}
        return {"mensaje": mensaje, "duplicado": False}


class ChatCuentasApiTest(unittest.TestCase):
    def setUp(self):
        self.ids = {
            "buyer_a": str(uuid.uuid4()), "buyer_b": str(uuid.uuid4()),
            "seller_a": str(uuid.uuid4()), "seller_b": str(uuid.uuid4()),
        }
        self.roles = {
            self.ids["buyer_a"]: "comprador", self.ids["buyer_b"]: "comprador",
            self.ids["seller_a"]: "vendedor", self.ids["seller_b"]: "vendedor",
        }
        self.tokens = {
            "access-buyer-a": self.ids["buyer_a"], "access-buyer-b": self.ids["buyer_b"],
            "access-seller-a": self.ids["seller_a"], "access-seller-b": self.ids["seller_b"],
        }
        self.vehiculos = {
            1: {"id": 1, "marca": "Toyota", "modelo": "Corolla", "anio": 2022, "vendedor_id": self.ids["seller_a"], "retirado": False},
            2: {"id": 2, "marca": "Honda", "modelo": "CR-V", "anio": 2021, "vendedor_id": self.ids["seller_b"], "retirado": False},
            3: {"id": 3, "marca": "Ford", "modelo": "Ranger", "anio": 2019, "vendedor_id": self.ids["seller_a"], "retirado": True},
            4: {"id": 4, "marca": "Nissan", "modelo": "Sentra", "anio": 2018, "vendedor_id": None, "retirado": False},
        }
        self.conversaciones = {}
        self.mensajes = {}
        self.repo = RepositorioCuentasFalso(self.ids, self.ids, self.vehiculos, self.conversaciones, self.mensajes)
        self.app = create_app({
            "TESTING": True, "SECRET_KEY": "api-v73-test", "USER_AUTH_ENABLED": True,
            "SESSION_COOKIE_SECURE": False, "APP_READ_ONLY": False,
            "CUENTA_AUTH": AuthFalsa({token: {"id": uid, "email": f"{token}@example.test"}
                                      for token, uid in self.tokens.items()}),
            "CUENTA_REPO": {
                "guardar_sesion": lambda usuario, verificador: self.repo.sesiones.update({verificador: usuario}),
                "leer_sesion": self.repo.sesiones.get,
                "borrar_sesion": lambda verificador: self.repo.sesiones.pop(verificador, None),
                "obtener_rol": self.roles.get,
                "obtener_nombre_visible": lambda _uid: None,
                "establecer_nombre_visible": lambda _uid, nombre: nombre,
            },
            "CHAT_CUENTAS_REPOSITORY": {
                nombre: getattr(self.repo, nombre) for nombre in (
                    "listar_conversaciones_comprador", "listar_conversaciones_vendedor",
                    "obtener_conversacion_vehiculo_comprador", "obtener_conversacion_comprador",
                    "obtener_conversacion_vendedor", "listar_mensajes_comprador",
                    "listar_mensajes_vendedor", "enviar_mensaje_comprador", "responder_vendedor",
                )
            },
        })
        self.clientes = {}
        for tipo, token_key in (
            ("buyer_a", "access-buyer-a"), ("buyer_b", "access-buyer-b"),
            ("seller_a", "access-seller-a"), ("seller_b", "access-seller-b"),
        ):
            client = self.app.test_client()
            client.get("/")
            sid = str(uuid.uuid4())
            self.repo.sesiones[cuentas.digest(sid)] = self.ids[tipo]
            client.set_cookie("cuenta_sid", sid)
            client.set_cookie("cuenta_access", token_key)
            self.clientes[tipo] = client
        self.conv_a = str(uuid.uuid4())
        self.conv_b = str(uuid.uuid4())
        ahora = datetime.now(timezone.utc).isoformat()
        self.conversaciones[self.conv_a] = {
            "id": self.conv_a, "comprador_id": self.ids["buyer_a"], "vendedor_id": self.ids["seller_a"],
            "vehiculo_id": 1, "marca": "Toyota", "modelo": "Corolla", "anio": 2022,
            "nombre_vendedor": "Vendedora Carla", "nombre_comprador": "Comprador Ana",
            "estado": "abierta", "created_at": ahora, "updated_at": ahora, "vehiculo_retirado": False,
        }
        self.conversaciones[self.conv_b] = {
            "id": self.conv_b, "comprador_id": self.ids["buyer_b"], "vendedor_id": self.ids["seller_b"],
            "vehiculo_id": 3, "marca": "Ford", "modelo": "Ranger", "anio": 2019,
            "nombre_vendedor": "Vendedor Diego", "nombre_comprador": "Compradora Beatriz",
            "estado": "atendida", "created_at": ahora, "updated_at": ahora, "vehiculo_retirado": True,
        }
        self.mensajes[self.conv_a] = [{
            "id": 1, "conversacion_id": self.conv_a, "autor_id": self.ids["buyer_a"],
            "remitente": "comprador", "contenido": "Consulta", "created_at": ahora,
        }]
        self.mensajes[self.conv_b] = [{
            "id": 1, "conversacion_id": self.conv_b, "autor_id": self.ids["buyer_b"],
            "remitente": "comprador", "contenido": "Historial retirado", "created_at": ahora,
        }]

    def _csrf(self, client):
        pagina = client.get("/")
        return re.search(rb'<meta name="csrf-token" content="([^"]+)', pagina.data).group(1).decode()

    @staticmethod
    def _key():
        return str(uuid.uuid4())

    def test_auth_required_expired_wrong_role_and_production_guard(self):
        anonymous = self.app.test_client()
        url = "/api/cuenta/chat/comprador/conversaciones"
        self.assertEqual(anonymous.get(url).status_code, 401)

        expired = self.app.test_client()
        expired.get("/")
        expired.set_cookie("cuenta_sid", "not-valid")
        expired.set_cookie("cuenta_access", "access-buyer-a")
        self.assertEqual(expired.get(url).status_code, 401)

        refresh_expired = self.app.test_client()
        refresh_expired.get("/")
        sid = str(uuid.uuid4())
        self.repo.sesiones[cuentas.digest(sid)] = self.ids["buyer_a"]
        refresh_expired.set_cookie("cuenta_sid", sid)
        refresh_expired.set_cookie("cuenta_access", "expired-access")
        refresh_expired.set_cookie("cuenta_refresh", "expired-refresh")
        refreshed = refresh_expired.get(url)
        self.assertEqual(refreshed.status_code, 401)
        self.assertIn("Max-Age=0", ";".join(refreshed.headers.getlist("Set-Cookie")))

        self.assertEqual(self.clientes["seller_a"].get(url).status_code, 403)
        with patch.dict(os.environ, {"VERCEL_ENV": "production"}):
            blocked = create_app({"TESTING": True, "SECRET_KEY": "prod-test",
                                  "USER_AUTH_ENABLED": True, "APP_READ_ONLY": False})
            self.assertEqual(blocked.test_client().get(url).status_code, 404)

    def test_buyer_listing_recovery_read_only_and_no_identifier_trust(self):
        url = "/api/cuenta/chat/comprador/conversaciones?comprador_id=" + self.ids["buyer_b"]
        result = self.clientes["buyer_a"].get(url)
        self.assertEqual(result.status_code, 200)
        self.assertEqual([c["id"] for c in result.json["conversaciones"]], [self.conv_a])
        self.assertEqual(result.headers["Cache-Control"], "no-store")
        self.assertNotIn("comprador_id", result.json["conversaciones"][0])
        self.assertNotIn("vendedor_id", result.json["conversaciones"][0])
        self.assertEqual(result.json["conversaciones"][0]["nombre_contacto"], "Vendedora Carla")
        self.assertNotIn("email", result.json["conversaciones"][0])
        called = [call for call in self.repo.llamadas if call[0] == "listar_comprador"][-1]
        self.assertEqual(called[1], self.ids["buyer_a"])

        recovered = self.clientes["buyer_a"].get(
            "/api/cuenta/chat/comprador/vehiculos/1/conversacion",
        )
        self.assertEqual(recovered.status_code, 200)
        self.assertEqual(recovered.json["conversacion"]["id"], self.conv_a)
        before = len(self.conversaciones)
        empty = self.clientes["buyer_a"].get(
            "/api/cuenta/chat/comprador/vehiculos/2/conversacion",
        )
        self.assertIsNone(empty.json["conversacion"])
        self.assertEqual(len(self.conversaciones), before)

    def test_buyer_sends_with_verified_identity_csrf_and_idempotency(self):
        client = self.clientes["buyer_a"]
        url = "/api/cuenta/chat/comprador/vehiculos/1/mensajes"
        content = {"contenido": "¿Sigue disponible?"}
        key = self._key()
        no_csrf = client.post(url, json=content, headers={"Idempotency-Key": key})
        self.assertEqual(no_csrf.status_code, 403)
        csrf = self._csrf(client)
        first = client.post(url, json=content, headers={"X-CSRF-Token": csrf, "Idempotency-Key": key})
        retry = client.post(url, json=content, headers={"X-CSRF-Token": csrf, "Idempotency-Key": key})
        self.assertEqual(first.status_code, 201, first.json)
        self.assertEqual(retry.status_code, 200)
        self.assertTrue(retry.json["duplicado"])
        call = [x for x in self.repo.llamadas if x[0] == "enviar_comprador"][-1]
        self.assertEqual(call[1], self.ids["buyer_a"])
        self.assertEqual(call[3], key)
        self.assertNotIn("autor_id", first.json["mensaje"])

        manipulado = client.post(
            url, json={"contenido": "X", "comprador_id": self.ids["buyer_b"]},
            headers={"X-CSRF-Token": csrf, "Idempotency-Key": self._key()},
        )
        self.assertEqual(manipulado.status_code, 400)
        reused = client.post(
            url, json={"contenido": "Otro contenido"},
            headers={"X-CSRF-Token": csrf, "Idempotency-Key": key},
        )
        self.assertEqual(reused.status_code, 409)

    def test_buyer_and_seller_isolation_retired_history_and_http_methods(self):
        buyer_b_url = f"/api/cuenta/chat/comprador/conversaciones/{self.conv_a}/mensajes"
        self.assertEqual(self.clientes["buyer_b"].get(buyer_b_url).status_code, 404)
        seller_b_url = f"/api/cuenta/chat/vendedor/conversaciones/{self.conv_a}/mensajes"
        self.assertEqual(self.clientes["seller_b"].get(seller_b_url).status_code, 404)
        self.assertEqual(self.clientes["seller_a"].get(seller_b_url).status_code, 200)

        retired_buyer_list = self.clientes["buyer_b"].get(
            "/api/cuenta/chat/comprador/conversaciones",
        )
        self.assertEqual([c["id"] for c in retired_buyer_list.json["conversaciones"]], [self.conv_b])
        seller_list = self.clientes["seller_b"].get(
            "/api/cuenta/chat/vendedor/conversaciones",
        )
        self.assertEqual([c["id"] for c in seller_list.json["conversaciones"]], [self.conv_b])
        self.assertEqual(seller_list.json["conversaciones"][0]["nombre_contacto"], "Compradora Beatriz")
        self.assertNotIn("nombre_comprador", seller_list.json["conversaciones"][0])
        before = len(self.conversaciones)
        retired_send = self.clientes["buyer_a"].post(
            "/api/cuenta/chat/comprador/vehiculos/3/mensajes",
            json={"contenido": "No iniciar chat retirado"},
            headers={"X-CSRF-Token": self._csrf(self.clientes["buyer_a"]),
                     "Idempotency-Key": self._key()},
        )
        self.assertEqual(retired_send.status_code, 404)
        self.assertEqual(len(self.conversaciones), before)

        retired = f"/api/cuenta/chat/vendedor/conversaciones/{self.conv_b}/mensajes"
        history = self.clientes["seller_b"].get(retired)
        self.assertEqual(history.status_code, 200)
        self.assertEqual(history.json["mensajes"][0]["contenido"], "Historial retirado")
        reply = self.clientes["seller_b"].post(
            retired, json={"contenido": "Respuesta"}, headers={
                "X-CSRF-Token": self._csrf(self.clientes["seller_b"]),
                "Idempotency-Key": self._key(),
            },
        )
        self.assertEqual(reply.status_code, 409)
        method_error = self.clientes["seller_b"].post(
            "/api/cuenta/chat/vendedor/conversaciones",
        )
        self.assertEqual(method_error.status_code, 405)
        self.assertIn("GET", method_error.headers["Allow"])

    def test_seller_owner_reply_idempotency_validation_and_limit_errors(self):
        client = self.clientes["seller_a"]
        url = f"/api/cuenta/chat/vendedor/conversaciones/{self.conv_a}/mensajes"
        csrf = self._csrf(client)
        key = self._key()
        headers = {"X-CSRF-Token": csrf, "Idempotency-Key": key}
        reply = client.post(url, json={"contenido": "Sí, está disponible."}, headers=headers)
        repeat = client.post(url, json={"contenido": "Sí, está disponible."}, headers=headers)
        self.assertEqual(reply.status_code, 201)
        self.assertEqual(repeat.status_code, 200)
        self.assertTrue(repeat.json["duplicado"])
        cantidad = len(self.repo.mensajes[self.conv_a])
        self.conversaciones[self.conv_a]["vehiculo_retirado"] = True
        replay_after_retirement = client.post(url, json={"contenido": "Sí, está disponible."}, headers=headers)
        self.assertEqual(replay_after_retirement.status_code, 200)
        self.assertTrue(replay_after_retirement.json["duplicado"])
        self.assertEqual(len(self.repo.mensajes[self.conv_a]), cantidad)
        new_after_retirement = client.post(
            url, json={"contenido": "Nueva respuesta"}, headers={
                "X-CSRF-Token": csrf, "Idempotency-Key": self._key(),
            },
        )
        self.assertEqual(new_after_retirement.status_code, 409)
        self.conversaciones[self.conv_a]["vehiculo_retirado"] = False
        spoof = client.post(
            url, json={"contenido": "No", "vendedor_id": self.ids["seller_b"]},
            headers={"X-CSRF-Token": csrf, "Idempotency-Key": self._key()},
        )
        self.assertEqual(spoof.status_code, 400)
        self.assertEqual(self.clientes["buyer_a"].post(
            url, json={"contenido": "No"}, headers={
                "X-CSRF-Token": self._csrf(self.clientes["buyer_a"]),
                "Idempotency-Key": self._key(),
            },
        ).status_code, 403)
        self.repo.limite = True
        buyer = self.clientes["buyer_a"]
        too_fast = buyer.post(
            "/api/cuenta/chat/comprador/vehiculos/1/mensajes",
            json={"contenido": "Rápido"},
            headers={"X-CSRF-Token": self._csrf(buyer), "Idempotency-Key": self._key()},
        )
        self.assertEqual(too_fast.status_code, 429)
        self.assertEqual(too_fast.headers["Retry-After"], "12")

    def test_validation_and_disabled_environment(self):
        client = self.clientes["buyer_a"]
        base = "/api/cuenta/chat/comprador/vehiculos/1/mensajes"
        csrf = self._csrf(client)
        headers = {"X-CSRF-Token": csrf, "Idempotency-Key": self._key()}
        self.assertEqual(client.post(base, json={"contenido": " "}, headers=headers).status_code, 422)
        self.assertEqual(client.post(
            base, json={"contenido": "x" * 2001},
            headers={"X-CSRF-Token": csrf, "Idempotency-Key": self._key()},
        ).status_code, 422)
        self.assertEqual(client.get(
            f"/api/cuenta/chat/comprador/conversaciones/{self.conv_a}/mensajes?despues_de_id=bad",
        ).status_code, 400)
        self.assertEqual(client.get(
            "/api/cuenta/chat/comprador/conversaciones?limite=101",
        ).status_code, 400)

        disabled = create_app({"TESTING": True, "SECRET_KEY": "disabled", "USER_AUTH_ENABLED": False})
        self.assertEqual(disabled.test_client().get(
            "/api/cuenta/chat/comprador/conversaciones",
        ).status_code, 404)


if __name__ == "__main__":
    unittest.main()
