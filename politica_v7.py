"""Política común de activación y solo lectura para V7.

Este módulo solo valida valores de configuración locales. No conecta con Auth ni
PostgreSQL y no incluye valores configurados en mensajes o registros.
"""
import os
import re
from urllib.parse import urlsplit


def _verdadero(valor):
    return valor is True or (isinstance(valor, str) and valor.strip().lower() in {"true", "1", "yes", "on"})


def _falso_explicito(valor):
    return valor is False or (isinstance(valor, str) and valor.strip().lower() in {"false", "0", "no", "off"})


def solo_lectura(config):
    """Preview nunca escribe; valores globales ausentes o inválidos fallan cerrado."""
    if os.environ.get("VERCEL_ENV", "").strip().lower() == "preview":
        return True
    valores = (os.environ.get("APP_READ_ONLY"), config.get("APP_READ_ONLY"))
    for valor in valores:
        if valor is None or valor == "" or _falso_explicito(valor):
            continue
        if _verdadero(valor) or valor is not None:
            return True
    return False


def _flag(config, nombre, entorno, defecto="false"):
    if config.get("TESTING") and nombre in config:
        return _verdadero(config[nombre])
    return _verdadero(os.environ.get(entorno, config.get(nombre, defecto)))


def _dependencias_reales_validas(config):
    secreto = config.get("SECRET_KEY")
    if not isinstance(secreto, str) or len(secreto) < 32:
        return False
    dsn = os.environ.get("DATABASE_URL", "").strip()
    try:
        partes = urlsplit(dsn)
        if partes.scheme not in {"postgres", "postgresql"} or not partes.hostname or not partes.path.strip("/"):
            return False
    except ValueError:
        return False
    url = os.environ.get("SUPABASE_URL", "").strip()
    if not re.fullmatch(r"https://[a-z0-9]{20}\.supabase\.co", url):
        return False
    publishable = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "").strip()
    anon = os.environ.get("SUPABASE_ANON_KEY", "").strip()
    clave_valida = publishable.startswith("sb_publishable_") or (not publishable and anon.startswith("eyJ"))
    if not clave_valida or any(c.isspace() for c in (publishable or anon)):
        return False
    entorno = os.environ.get("VERCEL_ENV", "").strip().lower()
    seguro = config.get("SESSION_COOKIE_SECURE") is True or _verdadero(config.get("SESSION_COOKIE_SECURE"))
    if entorno in {"preview", "production"} and not seguro:
        return False
    return True


def _dobles_locales_validos(config):
    """Permite pruebas aisladas con Auth simulado y persistencia inyectada/local."""
    if not config.get("TESTING") or config.get("CUENTA_AUTH") is None:
        return False
    return config.get("CUENTA_REPO") is not None or bool(os.environ.get("TEST_DATABASE_URL"))


def dependencias_v7_validas(config):
    return _dobles_locales_validos(config) or _dependencias_reales_validas(config)


def habilitada(config):
    """Habilitación V7: opt-in general, segunda llave de Production y servicios válidos."""
    if not _flag(config, "USER_AUTH_ENABLED", "USER_AUTH_ENABLED"):
        return False
    entorno = os.environ.get("VERCEL_ENV", "").strip().lower()
    if entorno == "production" and not _flag(config, "V7_PRODUCTION_ENABLED", "V7_PRODUCTION_ENABLED"):
        return False
    return dependencias_v7_validas(config)
