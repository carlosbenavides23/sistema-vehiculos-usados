"""Archivo anónimo: solo lectura, sin credenciales ni identidad de visitantes."""

from uuid import UUID
from persistencia import _conectar


def listar(vendedor_id, cursor=None):
    vendedor = str(UUID(str(vendedor_id)))
    cursor = str(UUID(str(cursor))) if cursor else None
    with _conectar() as db:
        filas = db.execute("""SELECT c.id, c.estado, v.id AS vehiculo_id,
                v.marca, v.modelo, v.anio, c.created_at,
                (SELECT m.created_at FROM public.mensajes_chat m
                 WHERE m.conversacion_id=c.id ORDER BY m.id DESC LIMIT 1) AS ultimo_mensaje_en,
                (SELECT left(m.contenido, 160) FROM public.mensajes_chat m
                 WHERE m.conversacion_id=c.id ORDER BY m.id DESC LIMIT 1) AS extracto
            FROM public.conversaciones c
            JOIN public.vehiculos v ON v.id=c.vehiculo_id
            JOIN public.roles_usuarios r ON r.usuario_id=v.vendedor_id AND r.rol='vendedor'
            WHERE v.vendedor_id=%s AND (%s::uuid IS NULL OR c.id<%s::uuid)
            ORDER BY c.id DESC LIMIT 51""", (vendedor, cursor, cursor)).fetchall()
    return filas[:50], str(filas[49]['id']) if len(filas) > 50 else None


def detalle(vendedor_id, conversacion_id, despues=0):
    vendedor, conversacion = str(UUID(str(vendedor_id))), str(UUID(str(conversacion_id)))
    with _conectar() as db:
        fila = db.execute("""SELECT c.id, c.estado, v.id AS vehiculo_id,
                v.marca, v.modelo, v.anio
            FROM public.conversaciones c
            JOIN public.vehiculos v ON v.id=c.vehiculo_id
            JOIN public.roles_usuarios r ON r.usuario_id=v.vendedor_id AND r.rol='vendedor'
            WHERE c.id=%s AND v.vendedor_id=%s""", (conversacion, vendedor)).fetchone()
        if fila is None:
            return None, [], None
        mensajes = db.execute("""SELECT m.id, m.remitente, m.contenido, m.created_at
            FROM public.mensajes_chat m
            JOIN public.conversaciones c ON c.id=m.conversacion_id
            JOIN public.vehiculos v ON v.id=c.vehiculo_id
            WHERE c.id=%s AND v.vendedor_id=%s AND m.id>%s
            ORDER BY m.id LIMIT 101""", (conversacion, vendedor, despues)).fetchall()
    return fila, mensajes[:100], mensajes[99]['id'] if len(mensajes) > 100 else None
