"""REST de Supabase Auth, exclusivamente desde el servidor."""
import json
import os
import re
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener, HTTPRedirectHandler


class ErrorAuth(RuntimeError):
    def __init__(self, mensaje='Acceso no válido.', status=401):
        super().__init__(mensaje)
        self.status=status


class SinRedireccion(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def solicitar(ruta, datos=None, token=None):
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    if not re.fullmatch(r"https://[a-z0-9]{20}\.supabase\.co", url):
        raise ErrorAuth("La autenticación no está configurada.",503)
    clave = os.environ.get("SUPABASE_PUBLISHABLE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
    if not clave:
        raise ErrorAuth("La autenticación no está configurada.",503)
    headers = {"apikey": clave, "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(url + "/auth/v1/" + ruta, headers=headers, data=json.dumps(datos).encode() if datos is not None else None)
    try:
        with build_opener(SinRedireccion()).open(request, timeout=10) as response:
            body = response.read(256_000)
            return json.loads(body) if body else {}
    except HTTPError as error:
        raise ErrorAuth(status=401 if error.code in (400,401,403,422) else 503) from None
    except (URLError, ValueError, TimeoutError):
        raise ErrorAuth(status=503) from None


def registrar(email, password, rol):
    # La migración copia el rol validado una sola vez, al crear auth.users.
    return solicitar("signup", {"email": email, "password": password, "data": {"v71_rol": rol}})


def login(email, password):
    return solicitar("token?grant_type=password", {"email": email, "password": password})


def usuario(token):
    return solicitar("user", token=token)


def renovar(token):
    return solicitar("token?grant_type=refresh_token", {"refresh_token": token})


def salir(token):
    return solicitar("logout?scope=local", {}, token=token)
