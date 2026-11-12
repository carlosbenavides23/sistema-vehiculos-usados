"""Asignación inicial de rol y consulta por identidad verificada de Auth."""

from uuid import UUID

from persistencia import _conectar

ROLES = frozenset(("comprador", "vendedor"))


def _identificador(valor):
    return str(UUID(str(valor)))


def obtener_rol(usuario_id):
    identificador = _identificador(usuario_id)
    with _conectar() as conexion, conexion.cursor() as cursor:
        cursor.execute("SELECT rol FROM public.roles_usuarios WHERE usuario_id = %s", (identificador,))
        fila = cursor.fetchone()
        return fila["rol"] if fila else None


def obtener_nombre_visible(usuario_id):
    identificador = _identificador(usuario_id)
    with _conectar() as conexion, conexion.cursor() as cursor:
        cursor.execute(
            "SELECT nombre_visible FROM public.perfiles_usuarios WHERE usuario_id = %s",
            (identificador,),
        )
        fila = cursor.fetchone()
        return fila["nombre_visible"] if fila else None



def asignar_rol_inicial(usuario_id, rol):
    """No reemplaza un rol existente, incluso ante registros simultáneos."""
    identificador = _identificador(usuario_id)
    if rol not in ROLES:
        raise ValueError("Rol no válido.")
    with _conectar() as conexion, conexion.cursor() as cursor:
        cursor.execute(
            "INSERT INTO public.roles_usuarios (usuario_id, rol) VALUES (%s, %s) "
            "ON CONFLICT (usuario_id) DO NOTHING RETURNING rol",
            (identificador, rol),
        )
        fila = cursor.fetchone()
        return fila["rol"] if fila else None
