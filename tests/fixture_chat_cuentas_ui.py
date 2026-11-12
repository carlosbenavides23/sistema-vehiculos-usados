import hashlib
import json
import os
import sys
import threading
import uuid
from werkzeug.serving import make_server

repo_root = os.environ.get("V733_REPO_ROOT", os.getcwd())
sys.path.insert(0, repo_root)
sys.path.insert(0, os.path.join(repo_root, "tests"))

import cuentas
import persistencia
import persistencia_chat_cuentas as chat
import propiedad
import roles_usuarios
from app import create_app
from auth_proveedor import ErrorAuth
from test_postgres_integracion import base_aislada, datos


class AuthDoble:
    def __init__(self, users): self.users = users
    def usuario(self, token):
        if token not in self.users: raise ErrorAuth()
        return self.users[token]
    def salir(self, token): return {}
    def login(self, email, password):
        if password != "local-fixture-password": raise ErrorAuth()
        for token, user in self.users.items():
            if user["email"] == email:
                return {"access_token": token, "refresh_token": "fixture-refresh"}
        raise ErrorAuth()


def main():
    os.environ.pop("VERCEL_ENV", None)
    os.environ.pop("VERCEL", None)
    os.environ["PYTHON_DOTENV_DISABLED"] = "1"
    os.environ["APP_READ_ONLY"] = "false"
    identities = {name: str(uuid.uuid5(uuid.NAMESPACE_URL, f"v733-qa-{name}"))
                  for name in ("buyer_a", "buyer_b", "seller_a", "seller_b")}
    tokens = {f"qa-token-{name}": {"id": user_id, "email": f"{name}@example.test"}
              for name, user_id in identities.items()}
    with base_aislada() as dsn:
        for name, role in (("buyer_a", "comprador"), ("buyer_b", "comprador"),
                           ("seller_a", "vendedor"), ("seller_b", "vendedor")):
            roles_usuarios.asignar_rol_inicial(identities[name], role)
            with persistencia._conectar() as db:
                db.execute(
                    "INSERT INTO public.perfiles_usuarios (usuario_id, nombre_visible) VALUES (%s, %s)",
                    (identities[name], {
                        "buyer_a": "Comprador Ana", "buyer_b": "Compradora Bea",
                        "seller_a": "Vendedora Carla", "seller_b": "<img src=x onerror=alert(1)>",
                    }[name]),
                )
            cuentas.guardar_sesion(identities[name], cuentas.digest(f"qa-session-{name}"))
        vehicles = {}
        for name, model, seller in (("active_a", "Corolla", "seller_a"),
                                    ("retired_a", "Escape", "seller_a"),
                                    ("active_b", "CR-V", "seller_b")):
            owner = identities[seller]
            token = propiedad.vendedor.set(owner)
            try:
                record = datos(model)
                record.update({"marca": "Toyota" if model == "Corolla" else "Ford" if model == "Escape" else "Honda",
                               "modelo": model, "anio": 2022})
                vehicles[name] = persistencia.crear_vehiculo(record)
            finally: propiedad.vendedor.reset(token)
        seeded = {}
        for name, content in (("active_a", "Mensaje inicial del comprador A"),
                              ("retired_a", "Historial de publicación retirada"), ("active_b", "Consulta de comprador A a vendedor B")):
            key = str(uuid.uuid4())
            result = chat.enviar_mensaje_comprador(identities["buyer_a"], vehicles[name]["id"], key,
                                                   hashlib.sha256(content.encode()).hexdigest(), content)
            if result is None: raise RuntimeError("No se pudo sembrar el mensaje aislado.")
            seeded[name] = str(result["conversacion"]["id"])
            if name == "active_a":
                reply = "Respuesta inicial del vendedor A"
                chat.responder_vendedor(identities["seller_a"], result["conversacion"]["id"], str(uuid.uuid4()),
                                        hashlib.sha256(reply.encode()).hexdigest(), reply)
        token = propiedad.vendedor.set(identities["seller_a"])
        try: persistencia.retirar_vehiculo(vehicles["retired_a"]["id"], vehicles["retired_a"]["updated_at"])
        finally: propiedad.vendedor.reset(token)
        archivo = []
        with persistencia._conectar() as db:
            for n in range(4):
                visitante = db.execute('INSERT INTO public.visitantes_anonimos DEFAULT VALUES RETURNING id').fetchone()['id']
                cid = db.execute('INSERT INTO public.conversaciones(visitante_id,vehiculo_id) VALUES (%s,%s) RETURNING id', (visitante, vehicles['active_a']['id'])).fetchone()['id']
                db.execute("INSERT INTO public.mensajes_chat(conversacion_id,remitente,contenido,clave_idempotencia,huella_solicitud) VALUES (%s,'comprador','Consulta histórica <script>sin ejecutar</script>',%s,%s)", (cid,str(uuid.uuid4()),'a'*64))
                archivo.append(str(cid))
        app = create_app({"TESTING": True, "SECRET_KEY": "v733-playwright-isolated-only",
                          "USER_AUTH_ENABLED": True, "APP_READ_ONLY": False, "SESSION_COOKIE_SECURE": False,
                          "CUENTA_AUTH": AuthDoble(tokens)})
        server = make_server("127.0.0.1", 0, app, threaded=True)
        info = {"url": f"http://127.0.0.1:{server.server_port}", "users": {}, "vehicles": {k: v["id"] for k,v in vehicles.items()}, "conversations": seeded}
        info['archive'] = archivo
        for name in identities:
            info["users"][name] = {"sid": f"qa-session-{name}", "access": f"qa-token-{name}"}
        print("V733_SERVER " + json.dumps(info), flush=True)
        threading.Thread(target=lambda: (sys.stdin.readline(), server.shutdown()), daemon=True).start()
        try: server.serve_forever()
        finally: server.server_close()


if __name__ == "__main__": main()
