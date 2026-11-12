"""Asignación inicial de rol y consulta por identidad verificada de Auth."""

from uuid import UUID

from persistencia import _conectar
from nombres_usuarios import normalizar_nombre_visible

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


def establecer_nombre_visible(usuario_id, nombre_visible):
    """Guarda el nombre del usuario verificado; el ID nunca viene del formulario."""
    identificador = _identificador(usuario_id)
    nombre = normalizar_nombre_visible(nombre_visible)
    with _conectar() as conexion, conexion.cursor() as cursor:
        cursor.execute(
            """INSERT INTO public.perfiles_usuarios (usuario_id, nombre_visible)
               SELECT usuario_id, %s FROM public.roles_usuarios
               WHERE usuario_id = %s AND rol IN ('comprador', 'vendedor')
               ON CONFLICT (usuario_id) DO UPDATE
                 SET nombre_visible = EXCLUDED.nombre_visible, updated_at = now()
               RETURNING nombre_visible""",
            (nombre, identificador),
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
