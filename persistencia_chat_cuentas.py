"""Persistencia privada del chat entre cuentas comprador y vendedor (V7.3.1).

Los IDs que recibe este módulo deben proceder de cuentas.identidad() verificada
por Flask. Las consultas vuelven a comprobar rol y participación en PostgreSQL.
El chat anónimo se conserva separado durante esta migración aditiva.
"""

import uuid

from persistencia import _conectar
from persistencia_chat import (
    LimiteMensajesChat,
    MAX_LISTADO,
    MAX_MENSAJES_POR_MINUTO,
    VENTANA_LIMITE_SEGUNDOS,
    _validar_mensaje,
)


def _uuid(valor, campo):
    try:
        return uuid.UUID(str(valor))
    except (ValueError, TypeError, AttributeError) as error:
        raise ValueError(f"{campo} debe ser un UUID válido.") from error


def _fila(fila):
    if fila is None:
        return None
    resultado = dict(fila)
    for campo in ("created_at", "updated_at", "ultimo_mensaje_en"):
        if campo in resultado and hasattr(resultado[campo], "isoformat"):
            resultado[campo] = resultado[campo].isoformat()
    return resultado


def _rol_valido(cursor, usuario_id, rol, bloqueo="KEY SHARE"):
    if bloqueo not in ("KEY SHARE", "UPDATE"):
        raise ValueError("Bloqueo de rol no permitido.")
    cursor.execute(
        f"SELECT usuario_id FROM public.roles_usuarios WHERE usuario_id = %s AND rol = %s FOR {bloqueo}",
        (usuario_id, rol),
    )
    return cursor.fetchone() is not None


def _conversacion(cursor, conversacion_id):
    cursor.execute(
        """SELECT c.*, v.vendedor_id, v.marca, v.modelo, v.anio,
                  (v.retirado_en IS NOT NULL) AS vehiculo_retirado
           FROM public.conversaciones_cuentas AS c
           JOIN public.vehiculos AS v ON v.id = c.vehiculo_id
           WHERE c.id = %s""",
        (conversacion_id,),
    )
    return _fila(cursor.fetchone())


def _crear_o_recuperar(cursor, comprador_id, vehiculo_id, permitir_historial_retirado=True):
    # Este bloqueo serializa el inicio del chat con el retiro lógico del vehículo.
    cursor.execute(
        "SELECT id, vendedor_id, retirado_en FROM public.vehiculos WHERE id = %s FOR UPDATE",
        (vehiculo_id,),
    )
    vehiculo = cursor.fetchone()
    if vehiculo is None:
        return None

    if vehiculo["retirado_en"] is not None:
        # Una conversación previa permanece consultable; no se crea otra.
        if not permitir_historial_retirado:
            return None
        cursor.execute(
            """SELECT id FROM public.conversaciones_cuentas
               WHERE comprador_id = %s AND vehiculo_id = %s""",
            (comprador_id, vehiculo_id),
        )
        existente = cursor.fetchone()
        return _conversacion(cursor, existente["id"]) if existente else None
    if vehiculo["vendedor_id"] is None:
        return None

    cursor.execute(
        """INSERT INTO public.conversaciones_cuentas (comprador_id, vehiculo_id)
           VALUES (%s, %s) ON CONFLICT (comprador_id, vehiculo_id) DO NOTHING""",
        (comprador_id, vehiculo_id),
    )
    cursor.execute(
        """SELECT id FROM public.conversaciones_cuentas
           WHERE comprador_id = %s AND vehiculo_id = %s FOR UPDATE""",
        (comprador_id, vehiculo_id),
    )
    fila = cursor.fetchone()
    return _conversacion(cursor, fila["id"])


def crear_o_recuperar_conversacion_comprador(comprador_id, vehiculo_id):
    comprador_id = _uuid(comprador_id, "comprador_id")
    try:
        vehiculo_id = int(vehiculo_id)
    except (ValueError, TypeError, OverflowError) as error:
        raise ValueError("vehiculo_id debe ser un entero válido.") from error
    if vehiculo_id <= 0:
        raise ValueError("vehiculo_id debe ser un entero positivo.")
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            if not _rol_valido(cursor, comprador_id, "comprador"):
                return None
            return _crear_o_recuperar(cursor, comprador_id, vehiculo_id)


def _listar(usuario_id, rol, cursor_id=None, limite=50):
    usuario_id = _uuid(usuario_id, f"{rol}_id")
    if cursor_id is not None:
        cursor_id = _uuid(cursor_id, "cursor_id")
    try:
        limite = max(1, min(int(limite), MAX_LISTADO))
    except (ValueError, TypeError, OverflowError) as error:
        raise ValueError("limite debe ser un entero válido.") from error

    comprador = rol == "comprador"
    alcance = "c.comprador_id = %s" if comprador else "v.vendedor_id = %s"
    parametros = [usuario_id]
    paginacion = ""
    if cursor_id is not None:
        filtro_cursor = "c2.comprador_id = %s" if comprador else "v2.vendedor_id = %s"
        paginacion = f"""AND (c.updated_at, c.id) < (
            SELECT c2.updated_at, c2.id
            FROM public.conversaciones_cuentas AS c2
            JOIN public.vehiculos AS v2 ON v2.id = c2.vehiculo_id
            WHERE c2.id = %s AND {filtro_cursor}
        )"""
        parametros.extend((cursor_id, usuario_id))
    parametros.append(limite)

    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            if not _rol_valido(cursor, usuario_id, rol):
                return []
            cursor.execute(
                f"""SELECT c.id, c.comprador_id, c.vehiculo_id, v.vendedor_id,
                           c.estado, c.created_at, c.updated_at,
                           (v.retirado_en IS NOT NULL) AS vehiculo_retirado,
                           v.marca, v.modelo, v.anio,
                           m.contenido AS ultimo_mensaje, m.remitente AS ultimo_remitente,
                           m.created_at AS ultimo_mensaje_en
                    FROM public.conversaciones_cuentas AS c
                    JOIN public.vehiculos AS v ON v.id = c.vehiculo_id
                    LEFT JOIN LATERAL (
                        SELECT contenido, remitente, created_at
                        FROM public.mensajes_chat_cuentas
                        WHERE conversacion_id = c.id ORDER BY id DESC LIMIT 1
                    ) AS m ON true
                    WHERE {alcance} {paginacion}
                    ORDER BY c.updated_at DESC, c.id DESC LIMIT %s""",
                tuple(parametros),
            )
            return [_fila(fila) for fila in cursor.fetchall()]


def listar_conversaciones_comprador(comprador_id, cursor_id=None, limite=50):
    return _listar(comprador_id, "comprador", cursor_id, limite)


def listar_conversaciones_vendedor(vendedor_id, cursor_id=None, limite=50):
    return _listar(vendedor_id, "vendedor", cursor_id, limite)


def _obtener(conversacion_id, usuario_id, rol):
    conversacion_id = _uuid(conversacion_id, "conversacion_id")
    usuario_id = _uuid(usuario_id, f"{rol}_id")
    alcance = "c.comprador_id = %s" if rol == "comprador" else "v.vendedor_id = %s"
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            cursor.execute(
                f"""SELECT c.*, v.vendedor_id, v.marca, v.modelo, v.anio,
                           (v.retirado_en IS NOT NULL) AS vehiculo_retirado
                    FROM public.conversaciones_cuentas AS c
                    JOIN public.vehiculos AS v ON v.id = c.vehiculo_id
                    WHERE c.id = %s AND {alcance}""",
                (conversacion_id, usuario_id),
            )
            return _fila(cursor.fetchone())


def obtener_conversacion_comprador(conversacion_id, comprador_id):
    return _obtener(conversacion_id, comprador_id, "comprador")


def obtener_conversacion_vendedor(conversacion_id, vendedor_id):
    return _obtener(conversacion_id, vendedor_id, "vendedor")


def obtener_conversacion_vehiculo_comprador(comprador_id, vehiculo_id):
    """Busca sin crear una conversación al abrir el chat desde la ficha."""
    comprador_id = _uuid(comprador_id, "comprador_id")
    try:
        vehiculo_id = int(vehiculo_id)
    except (ValueError, TypeError, OverflowError) as error:
        raise ValueError("vehiculo_id debe ser un entero válido.") from error
    if vehiculo_id <= 0:
        raise ValueError("vehiculo_id debe ser un entero positivo.")
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            cursor.execute(
                """SELECT c.id FROM public.conversaciones_cuentas AS c
                   JOIN public.roles_usuarios AS r
                     ON r.usuario_id = c.comprador_id AND r.rol = 'comprador'
                   WHERE c.comprador_id = %s AND c.vehiculo_id = %s""",
                (comprador_id, vehiculo_id),
            )
            conversacion = cursor.fetchone()
            return _conversacion(cursor, conversacion["id"]) if conversacion else None


def _mensajes(conversacion_id, usuario_id, rol, despues_de_id):
    conversacion_id = _uuid(conversacion_id, "conversacion_id")
    usuario_id = _uuid(usuario_id, f"{rol}_id")
    try:
        despues_de_id = max(0, int(despues_de_id))
    except (ValueError, TypeError, OverflowError) as error:
        raise ValueError("despues_de_id debe ser un entero no negativo.") from error
    alcance = "c.comprador_id = %s" if rol == "comprador" else "v.vendedor_id = %s"
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            cursor.execute(
                f"""SELECT a.id AS autorizado_id,
                           m.id, m.conversacion_id, m.autor_id, m.remitente,
                           m.contenido, m.created_at
                    FROM (
                        SELECT c.id FROM public.conversaciones_cuentas AS c
                        JOIN public.vehiculos AS v ON v.id = c.vehiculo_id
                        WHERE c.id = %s AND {alcance}
                    ) AS a
                    LEFT JOIN public.mensajes_chat_cuentas AS m
                      ON m.conversacion_id = a.id AND m.id > %s
                    ORDER BY m.id ASC LIMIT 200""",
                (conversacion_id, usuario_id, despues_de_id),
            )
            filas = cursor.fetchall()
            if not filas:
                return None
            campos = ("id", "conversacion_id", "autor_id", "remitente", "contenido", "created_at")
            return [_fila({campo: fila[campo] for campo in campos}) for fila in filas if fila["id"] is not None]


def listar_mensajes_comprador(conversacion_id, comprador_id, despues_de_id=0):
    return _mensajes(conversacion_id, comprador_id, "comprador", despues_de_id)


def listar_mensajes_vendedor(conversacion_id, vendedor_id, despues_de_id=0):
    return _mensajes(conversacion_id, vendedor_id, "vendedor", despues_de_id)


def _mensaje_existente(cursor, clave, huella, remitente, autor_id, conversacion_id=None, vehiculo_id=None):
    cursor.execute(
        """SELECT m.*, c.comprador_id, c.vehiculo_id, v.vendedor_id
           FROM public.mensajes_chat_cuentas AS m
           JOIN public.conversaciones_cuentas AS c ON c.id = m.conversacion_id
           JOIN public.vehiculos AS v ON v.id = c.vehiculo_id
           WHERE m.clave_idempotencia = %s""",
        (clave,),
    )
    mensaje = cursor.fetchone()
    if mensaje is None:
        return None
    coincide = (
        mensaje["remitente"] == remitente
        and mensaje["autor_id"] == autor_id
        and mensaje["huella_solicitud"].strip() == huella
        and (conversacion_id is None or mensaje["conversacion_id"] == conversacion_id)
        and (vehiculo_id is None or mensaje["vehiculo_id"] == vehiculo_id)
    )
    if not coincide:
        raise ValueError("La clave idempotente ya fue utilizada por otra solicitud.")
    conversacion = _conversacion(cursor, mensaje["conversacion_id"])
    campos = ("id", "conversacion_id", "autor_id", "remitente", "contenido", "created_at")
    salida = _fila({campo: mensaje[campo] for campo in campos})
    return {"conversacion": conversacion, "mensaje": salida, "duplicado": True}


def _limite_comprador(cursor, comprador_id):
    cursor.execute(
        """SELECT count(*) AS total,
                  ceil(extract(epoch FROM (min(m.created_at) + interval '60 seconds' - now()))) AS espera
           FROM public.mensajes_chat_cuentas AS m
           JOIN public.conversaciones_cuentas AS c ON c.id = m.conversacion_id
           WHERE c.comprador_id = %s AND m.remitente = 'comprador'
             AND m.created_at >= now() - interval '60 seconds'""",
        (comprador_id,),
    )
    fila = cursor.fetchone()
    if fila["total"] >= MAX_MENSAJES_POR_MINUTO:
        raise LimiteMensajesChat(fila["espera"] or VENTANA_LIMITE_SEGUNDOS)


def _insertar_mensaje(cursor, conversacion_id, autor_id, remitente, clave, huella, contenido):
    cursor.execute(
        """INSERT INTO public.mensajes_chat_cuentas
           (conversacion_id, autor_id, remitente, contenido, clave_idempotencia, huella_solicitud)
           VALUES (%s, %s, %s, %s, %s, %s)
           ON CONFLICT (clave_idempotencia) DO NOTHING RETURNING *""",
        (conversacion_id, autor_id, remitente, contenido, clave, huella),
    )
    fila = cursor.fetchone()
    if fila is not None:
        campos = ("id", "conversacion_id", "autor_id", "remitente", "contenido", "created_at")
        return _fila({campo: fila[campo] for campo in campos})
    existente = _mensaje_existente(
        cursor, clave, huella, remitente, autor_id, conversacion_id=conversacion_id,
    )
    if existente is None:
        raise ValueError("La clave idempotente ya fue utilizada por otra solicitud.")
    return existente["mensaje"]


def enviar_mensaje_comprador(comprador_id, vehiculo_id, clave_idempotencia, huella, contenido):
    comprador_id = _uuid(comprador_id, "comprador_id")
    try:
        vehiculo_id = int(vehiculo_id)
    except (ValueError, TypeError, OverflowError) as error:
        raise ValueError("vehiculo_id debe ser un entero válido.") from error
    if vehiculo_id <= 0:
        raise ValueError("vehiculo_id debe ser un entero positivo.")
    clave, huella, contenido = _validar_mensaje(clave_idempotencia, huella, contenido)

    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            if not _rol_valido(cursor, comprador_id, "comprador", "UPDATE"):
                return None
            existente = _mensaje_existente(
                cursor, clave, huella, "comprador", comprador_id, vehiculo_id=vehiculo_id,
            )
            if existente is not None:
                return existente
            _limite_comprador(cursor, comprador_id)
            conversacion = _crear_o_recuperar(
                cursor, comprador_id, vehiculo_id, permitir_historial_retirado=False,
            )
            if conversacion is None:
                return None
            cursor.execute(
                """SELECT id FROM public.conversaciones_cuentas
                   WHERE id = %s AND comprador_id = %s FOR UPDATE""",
                (conversacion["id"], comprador_id),
            )
            if cursor.fetchone() is None:
                return None
            mensaje = _insertar_mensaje(
                cursor, conversacion["id"], comprador_id, "comprador", clave, huella, contenido,
            )
            cursor.execute(
                """UPDATE public.conversaciones_cuentas SET estado = 'abierta', updated_at = now()
                   WHERE id = %s AND comprador_id = %s""",
                (conversacion["id"], comprador_id),
            )
            conversacion["estado"] = "abierta"
            conversacion["updated_at"] = mensaje["created_at"]
            return {"conversacion": conversacion, "mensaje": mensaje, "duplicado": False}


def responder_vendedor(vendedor_id, conversacion_id, clave_idempotencia, huella, contenido):
    vendedor_id = _uuid(vendedor_id, "vendedor_id")
    conversacion_id = _uuid(conversacion_id, "conversacion_id")
    clave, huella, contenido = _validar_mensaje(clave_idempotencia, huella, contenido)

    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            if not _rol_valido(cursor, vendedor_id, "vendedor"):
                return None
            # Sigue el orden vehículo -> conversación, igual que el envío del
            # comprador, y se coordina con el retiro lógico antes de responder.
            cursor.execute(
                """SELECT c.id, c.vehiculo_id, v.retirado_en
                   FROM public.conversaciones_cuentas AS c
                   JOIN public.vehiculos AS v ON v.id = c.vehiculo_id
                   WHERE c.id = %s AND v.vendedor_id = %s FOR UPDATE OF v""",
                (conversacion_id, vendedor_id),
            )
            vehiculo = cursor.fetchone()
            if vehiculo is None:
                return None
            cursor.execute(
                "SELECT id FROM public.conversaciones_cuentas WHERE id = %s FOR UPDATE",
                (conversacion_id,),
            )
            if cursor.fetchone() is None:
                return None
            existente = _mensaje_existente(
                cursor, clave, huella, "vendedor", vendedor_id, conversacion_id=conversacion_id,
            )
            if existente is not None:
                return {"mensaje": existente["mensaje"], "duplicado": True}
            if vehiculo["retirado_en"] is not None:
                return None
            mensaje = _insertar_mensaje(
                cursor, conversacion_id, vendedor_id, "vendedor", clave, huella, contenido,
            )
            cursor.execute(
                """UPDATE public.conversaciones_cuentas SET updated_at = now()
                   WHERE id = %s AND EXISTS (
                       SELECT 1 FROM public.vehiculos AS v
                       WHERE v.id = conversaciones_cuentas.vehiculo_id AND v.vendedor_id = %s
                   )""",
                (conversacion_id, vendedor_id),
            )
            return {"mensaje": mensaje, "duplicado": False}


def marcar_atendida(vendedor_id, conversacion_id):
    vendedor_id = _uuid(vendedor_id, "vendedor_id")
    conversacion_id = _uuid(conversacion_id, "conversacion_id")
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            if not _rol_valido(cursor, vendedor_id, "vendedor"):
                return None
            cursor.execute(
                """UPDATE public.conversaciones_cuentas AS c
                   SET estado = 'atendida', updated_at = now()
                   FROM public.vehiculos AS v
                   WHERE c.id = %s AND v.id = c.vehiculo_id AND v.vendedor_id = %s
                   RETURNING c.*""",
                (conversacion_id, vendedor_id),
            )
            return _fila(cursor.fetchone())
