"""Ámbito de repositorio por solicitud; las escrituras V6 solo alcanzan heredados."""
from contextvars import ContextVar

vendedor = ContextVar('vendedor', default=None)
privado = ContextVar('privado', default=False)


def condicion():
    owner = vendedor.get()
    return ('vendedor_id = %s', (owner,)) if owner else ('vendedor_id IS NULL', ())


def lectura():
    return condicion() if privado.get() else ('TRUE', ())
