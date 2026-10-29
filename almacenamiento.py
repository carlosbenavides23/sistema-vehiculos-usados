"""Adaptador REST de Supabase Storage; las credenciales nunca salen de Flask."""

import hashlib
import hmac
import json
import os
import re
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


BUCKET = "vehiculos"
URL_PROYECTO = "https://rtcygltmrtulyeezaaac.supabase.co"
PATRON_RUTA = re.compile(r"[1-9][0-9]{0,15}/[0-9a-f]{32}\.webp\Z")
TIEMPO_ESPERA = 15


class ErrorAlmacenamiento(RuntimeError):
    """Fallo de infraestructura con mensaje público y sin secretos."""

    def __init__(self, mensaje="No se pudo completar la operación de fotografías.", duplicado=False):
        super().__init__(mensaje)
        self.duplicado = duplicado


class _SinRedirecciones(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Impide reenviar Authorization si un endpoint responde con redirección.
        return None


def _base_url():
    valor = os.environ.get("SUPABASE_URL", URL_PROYECTO).strip().rstrip("/")
    parsed = urlsplit(valor)
    if parsed.scheme != "https" or not re.fullmatch(r"[a-z0-9]{20}\.supabase\.co", parsed.netloc) or parsed.path or parsed.query or parsed.fragment:
        raise ErrorAlmacenamiento("La configuración de fotografías no es válida.")
    return valor


def _ruta_valida(ruta):
    if not isinstance(ruta, str) or not PATRON_RUTA.fullmatch(ruta):
        raise ErrorAlmacenamiento("La referencia de la fotografía no es válida.")
    return ruta


def url_publica(ruta):
    ruta = _ruta_valida(ruta)
    return f"{_base_url()}/storage/v1/object/public/{BUCKET}/{quote(ruta, safe='/')}"


def _transporte(solicitud):
    return build_opener(_SinRedirecciones()).open(solicitud, timeout=TIEMPO_ESPERA)


def _enviar(metodo, ruta, datos, content_type, admitir_ausente=False, max_respuesta=64_000):
    clave = (os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")).strip()
    if not clave or "\r" in clave or "\n" in clave:
        raise ErrorAlmacenamiento("El almacenamiento de fotografías no está configurado.")
    solicitud = Request(f"{_base_url()}/storage/v1/{ruta}", data=datos, method=metodo)
    if not clave.startswith("sb_secret_"):
        solicitud.add_header("Authorization", f"Bearer {clave}")
    solicitud.add_header("apikey", clave)
    solicitud.add_header("Content-Type", content_type)
    solicitud.add_header("x-upsert", "false")
    solicitud.add_header("Cache-Control", "no-cache")
    try:
        with _transporte(solicitud) as respuesta:
            if not 200 <= respuesta.status < 300:
                raise ErrorAlmacenamiento()
            return respuesta.read(max_respuesta)
    except HTTPError as error:
        try:
            if admitir_ausente and error.code == 404:
                return
            duplicado = error.code == 409
            if error.code == 400:
                # Supabase Storage también puede expresar Duplicate con HTTP 400.
                try:
                    cuerpo = json.loads(error.read(16_000))
                    duplicado = str(cuerpo.get("statusCode")) == "409" or cuerpo.get("error") == "Duplicate"
                except (ValueError, AttributeError):
                    pass
            raise ErrorAlmacenamiento(duplicado=duplicado) from None
        finally:
            error.close()
    except (URLError, OSError, TimeoutError):
        raise ErrorAlmacenamiento("El almacenamiento no respondió. Intenta de nuevo.") from None


def subir(ruta, contenido):
    """Sube sin sobrescribir. Una repetición del mismo path es idempotente.

    Los paths los reserva PostgreSQL con UUID y huella antes de esta llamada;
    ningún cliente elige un path ni se permite x-upsert sobre un objeto previo.
    """
    ruta = _ruta_valida(ruta)
    if not isinstance(contenido, bytes) or not 1 <= len(contenido) <= 1_000_000:
        raise ErrorAlmacenamiento("La fotografía supera el tamaño permitido.")
    try:
        _enviar("POST", f"object/{BUCKET}/{quote(ruta, safe='/')}", contenido, "image/webp")
        return True
    except ErrorAlmacenamiento as error:
        if error.duplicado:
            # Un 409 puede coincidir con otra subida aún en curso. No se
            # confirma la referencia DB hasta poder leer los mismos bytes.
            existente = _enviar("GET", f"object/authenticated/{BUCKET}/{quote(ruta, safe='/')}", None, "application/octet-stream", max_respuesta=1_000_001)
            if len(existente) != len(contenido) or not hmac.compare_digest(hashlib.sha256(existente).digest(), hashlib.sha256(contenido).digest()):
                raise ErrorAlmacenamiento("La carga anterior aún no pudo verificarse. Intenta de nuevo con la misma fotografía.")
            return False
        raise


def eliminar(ruta):
    ruta = _ruta_valida(ruta)
    _enviar("DELETE", f"object/{BUCKET}", json.dumps({"prefixes": [ruta]}).encode(), "application/json", admitir_ausente=True)


def limpiar_pendientes(limite=10, aplicar=False, repositorio=None, proveedor=None):
    """Previsualiza la cola durable; solo borra con aplicar=True explícito.

    El repositorio excluye referencias activas y reservas aún vigentes. Los
    objetos nuevos usan rutas únicas: una ruta retirada no vuelve a usarse.
    Si Storage o la confirmación falla, el pendiente permanece para reintento.
    """
    if type(limite) is not int or not 1 <= limite <= 100:
        raise ValueError("El límite debe estar entre 1 y 100.")
    if repositorio is None:
        import persistencia_fotos
        repositorio = lambda nombre, *args: getattr(persistencia_fotos, nombre)(*args)
    proveedor = proveedor or __import__(__name__)
    pendientes = repositorio("pendientes_limpieza", limite)
    resultado = {"pendientes": len(pendientes), "eliminados": 0, "fallidos": 0, "aplicado": bool(aplicar)}
    if not aplicar:
        return resultado
    for pendiente in pendientes:
        try:
            if not repositorio("reclamar_limpieza", pendiente["id"]):
                continue
            proveedor.eliminar(pendiente["storage_path"])
            repositorio("confirmar_limpieza", pendiente["id"])
            resultado["eliminados"] += 1
        except Exception:
            # No se imprime el error del proveedor ni una ruta privada.
            resultado["fallidos"] += 1
    return resultado
