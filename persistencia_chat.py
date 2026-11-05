"""Persistencia PostgreSQL privada para conversaciones del catálogo.

La autenticación y autorización HTTP pertenecen a Flask. Este módulo recibe
únicamente IDs/verificadores ya resueltos por el servidor. Nunca almacena el
token anónimo en claro y reutiliza la conexión TLS/timeout de persistencia.py.
"""

from datetime import datetime, timezone
import re
import uuid

from persistencia import _conectar


_HASH = re.compile(r"^[0-9a-f]{64}$")
MAX_MENSAJES_POR_MINUTO = 8
VENTANA_LIMITE_SEGUNDOS = 60
MAX_INICIOS_SESION_POR_HORA = 20
VENTANA_INICIO_SESION_SEGUNDOS = 3600
MAX_CONTENIDO = 4000
MAX_LISTADO = 100


class LimiteMensajesChat(Exception):
    """Se alcanzó el límite persistente de mensajes de comprador."""

    def __init__(self, retry_after):
        self.retry_after = max(1, int(retry_after))
        super().__init__("Se alcanzó el límite temporal de mensajes.")


class LimiteInicioSesionChat(Exception):
    """Se alcanzó el límite persistente de emisión de sesiones anónimas."""

    def __init__(self, retry_after):
        self.retry_after = max(1, int(retry_after))
        super().__init__("Se alcanzó el límite temporal de nuevas sesiones de chat.")


def _hash_valido(valor, campo):
    if not isinstance(valor, str) or not _HASH.fullmatch(valor):
        raise ValueError(f"{campo} debe ser SHA-256 hexadecimal en minúsculas.")
    return valor


def reservar_inicio_sesion_chat(clave_hash):
    """Reserva un inicio dentro de una ventana horaria fija, atómicamente.

    `clave_hash` debe ser un digest HMAC generado por Flask a partir del origen
    de red. Este módulo no recibe ni guarda direcciones IP en claro.
    """
    clave_hash = _hash_valido(clave_hash, "clave_hash")
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            cursor.execute(
                """DELETE FROM public.chat_inicio_sesion_limites
                   WHERE clave_hash IN (
                       SELECT clave_hash FROM public.chat_inicio_sesion_limites
                       WHERE ventana_desde < now() - interval '1 day'
                       ORDER BY ventana_desde LIMIT 100
                   )""",
            )
            cursor.execute(
                """INSERT INTO public.chat_inicio_sesion_limites
                       (clave_hash, ventana_desde, intentos)
                   VALUES (
                       %s,
                       date_trunc('hour', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
                       1
                   )
                   ON CONFLICT (clave_hash) DO UPDATE SET
                       intentos = CASE
                           WHEN chat_inicio_sesion_limites.ventana_desde < EXCLUDED.ventana_desde
                               THEN 1
                           ELSE LEAST(chat_inicio_sesion_limites.intentos + 1, %s + 1)
                       END,
                       ventana_desde = CASE
                           WHEN chat_inicio_sesion_limites.ventana_desde < EXCLUDED.ventana_desde
                               THEN EXCLUDED.ventana_desde
                           ELSE chat_inicio_sesion_limites.ventana_desde
                       END
                   RETURNING intentos,
                       GREATEST(1, ceil(extract(epoch FROM
                           (ventana_desde + interval '1 hour' - now())))) AS retry_after""",
                (clave_hash, MAX_INICIOS_SESION_POR_HORA),
            )
            reserva = cursor.fetchone()
            if reserva["intentos"] > MAX_INICIOS_SESION_POR_HORA:
                raise LimiteInicioSesionChat(reserva["retry_after"])
            return 0


def _uuid(valor, campo):
    try:
        return uuid.UUID(str(valor))
    except (ValueError, TypeError, AttributeError) as error:
        raise ValueError(f"{campo} debe ser un UUID válido.") from error


def _fecha(valor):
    if isinstance(valor, datetime):
        return valor.isoformat()
    return valor


def _fila(fila):
    if fila is None:
        return None
    resultado = dict(fila)
    for campo in ("created_at", "updated_at", "expires_at", "revoked_at", "ultimo_mensaje_en"):
        if campo in resultado:
            resultado[campo] = _fecha(resultado[campo])
    return resultado


def _mensaje_existente(cursor, clave, huella, remitente, visitante_id=None, conversacion_id=None):
    cursor.execute(
        """SELECT m.*, c.visitante_id FROM public.mensajes_chat AS m
           JOIN public.conversaciones AS c ON c.id = m.conversacion_id
           WHERE m.clave_idempotencia = %s""",
        (clave,),
    )
    mensaje = cursor.fetchone()
    if mensaje is None:
        return None
    autorizado = (
        mensaje["remitente"] == remitente
        and mensaje["huella_solicitud"].strip() == huella
        and (visitante_id is None or mensaje["visitante_id"] == visitante_id)
        and (conversacion_id is None or mensaje["conversacion_id"] == conversacion_id)
    )
    if not autorizado:
        raise ValueError("La clave idempotente ya fue utilizada por otra solicitud.")
    cursor.execute(
        "SELECT * FROM public.conversaciones WHERE id = %s",
        (mensaje["conversacion_id"],),
    )
    conversacion = _fila(cursor.fetchone())
    salida = {campo: mensaje[campo] for campo in (
        "id", "conversacion_id", "remitente", "contenido", "created_at",
    )}
    return {"conversacion": conversacion, "mensaje": _fila(salida), "duplicado": True}


def crear_visitante_y_sesion(verificador_hash, expira_en):
    """Crea IDs nuevos y persiste solo el hash de la credencial aleatoria."""
    verificador_hash = _hash_valido(verificador_hash, "verificador_hash")
    if not isinstance(expira_en, datetime) or expira_en.tzinfo is None:
        raise ValueError("expira_en debe incluir zona horaria.")
    ahora = datetime.now(timezone.utc)
    if expira_en <= ahora:
        raise ValueError("La expiración debe estar en el futuro.")
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            cursor.execute(
                "INSERT INTO public.visitantes_anonimos DEFAULT VALUES RETURNING id",
            )
            visitante_id = cursor.fetchone()["id"]
            cursor.execute(
                """INSERT INTO public.sesiones_visitante
                   (visitante_id, verificador, expires_at)
                   VALUES (%s, %s, %s) RETURNING id""",
                (visitante_id, verificador_hash, expira_en),
            )
            sesion_id = cursor.fetchone()["id"]
    return {"visitante_id": visitante_id, "sesion_id": sesion_id}


def resolver_visitante(verificador_hash):
    """Resuelve solo sesiones activas; un hash desconocido nunca se crea aquí."""
    verificador_hash = _hash_valido(verificador_hash, "verificador_hash")
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            cursor.execute(
                """SELECT s.id AS sesion_id, s.visitante_id, s.expires_at
                   FROM public.sesiones_visitante AS s
                   WHERE s.verificador = %s AND s.revoked_at IS NULL
                     AND s.expires_at > now()""",
                (verificador_hash,),
            )
            return _fila(cursor.fetchone())


def revocar_sesion_visitante(verificador_hash):
    verificador_hash = _hash_valido(verificador_hash, "verificador_hash")
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            cursor.execute(
                """UPDATE public.sesiones_visitante SET revoked_at = now()
                   WHERE verificador = %s AND revoked_at IS NULL
                   RETURNING id""",
                (verificador_hash,),
            )
            return cursor.fetchone() is not None


def conversacion_por_vehiculo(visitante_id, vehiculo_id):
    visitante_id = _uuid(visitante_id, "visitante_id")
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            cursor.execute(
                """SELECT c.*, v.marca, v.modelo, v.anio
                   FROM public.conversaciones AS c
                   JOIN public.vehiculos AS v ON v.id = c.vehiculo_id
                   WHERE c.visitante_id = %s AND c.vehiculo_id = %s""",
                (visitante_id, vehiculo_id),
            )
            return _fila(cursor.fetchone())


def listar_conversaciones_visitante(visitante_id):
    visitante_id = _uuid(visitante_id, "visitante_id")
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            cursor.execute(
                """SELECT c.id, c.vehiculo_id, c.estado, c.created_at, c.updated_at,
                          v.marca, v.modelo, v.anio,
                          m.contenido AS ultimo_mensaje,
                          m.created_at AS ultimo_mensaje_en
                   FROM public.conversaciones AS c
                   JOIN public.vehiculos AS v ON v.id = c.vehiculo_id
                   LEFT JOIN LATERAL (
                       SELECT contenido, created_at FROM public.mensajes_chat
                       WHERE conversacion_id = c.id ORDER BY id DESC LIMIT 1
                   ) AS m ON true
                   WHERE c.visitante_id = %s
                   ORDER BY c.updated_at DESC, c.id DESC""",
                (visitante_id,),
            )
            return [_fila(fila) for fila in cursor.fetchall()]


def _validar_mensaje(clave_idempotencia, huella, contenido):
    clave = _uuid(clave_idempotencia, "clave_idempotencia")
    huella = _hash_valido(huella, "huella")
    if not isinstance(contenido, str):
        raise ValueError("contenido debe ser texto.")
    if not 1 <= len(contenido.strip()) <= MAX_CONTENIDO:
        raise ValueError("contenido debe tener entre 1 y 4000 caracteres no blancos.")
    return clave, huella, contenido.strip()


def _bloquear_visitante(cursor, visitante_id):
    """Serializa solicitudes de un visitante para dedupe y cuota entre workers."""
    cursor.execute(
        "SELECT id FROM public.visitantes_anonimos WHERE id = %s FOR UPDATE",
        (visitante_id,),
    )
    return cursor.fetchone() is not None


def _validar_limite(cursor, visitante_id):
    cursor.execute(
        """SELECT count(*) AS total,
                  ceil(extract(epoch FROM (min(m.created_at) + interval '60 seconds' - now()))) AS espera
           FROM public.mensajes_chat AS m
           JOIN public.conversaciones AS c ON c.id = m.conversacion_id
           WHERE c.visitante_id = %s AND m.remitente = 'comprador'
             AND m.created_at >= now() - interval '60 seconds'""",
        (visitante_id,),
    )
    cuenta = cursor.fetchone()
    if cuenta["total"] >= MAX_MENSAJES_POR_MINUTO:
        raise LimiteMensajesChat(cuenta["espera"] or VENTANA_LIMITE_SEGUNDOS)


def enviar_mensaje_comprador(visitante_id, vehiculo_id, clave_idempotencia, huella, contenido):
    """Crea conversación al primer mensaje e inserta de forma idempotente."""
    visitante_id = _uuid(visitante_id, "visitante_id")
    clave, huella, contenido = _validar_mensaje(clave_idempotencia, huella, contenido)
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            if not _bloquear_visitante(cursor, visitante_id):
                return None
            existente = _mensaje_existente(cursor, clave, huella, "comprador", visitante_id)
            if existente is not None:
                return existente
            _validar_limite(cursor, visitante_id)
            cursor.execute("SELECT id FROM public.vehiculos WHERE id = %s", (vehiculo_id,))
            if cursor.fetchone() is None:
                return None
            cursor.execute(
                """INSERT INTO public.conversaciones (vehiculo_id, visitante_id)
                   VALUES (%s, %s) ON CONFLICT (vehiculo_id, visitante_id) DO NOTHING""",
                (vehiculo_id, visitante_id),
            )
            cursor.execute(
                """SELECT * FROM public.conversaciones
                   WHERE vehiculo_id = %s AND visitante_id = %s FOR UPDATE""",
                (vehiculo_id, visitante_id),
            )
            conversacion = _fila(cursor.fetchone())
            cursor.execute(
                """INSERT INTO public.mensajes_chat
                   (conversacion_id, remitente, contenido, clave_idempotencia, huella_solicitud)
                   VALUES (%s, 'comprador', %s, %s, %s) RETURNING *""",
                (conversacion["id"], contenido, clave, huella),
            )
            guardado = cursor.fetchone()
            mensaje = _fila({campo: guardado[campo] for campo in (
                "id", "conversacion_id", "remitente", "contenido", "created_at",
            )})
            cursor.execute(
                """UPDATE public.conversaciones
                   SET estado = 'abierta', updated_at = now() WHERE id = %s""",
                (conversacion["id"],),
            )
            conversacion["estado"] = "abierta"
            conversacion["updated_at"] = mensaje["created_at"]
            return {"conversacion": conversacion, "mensaje": mensaje, "duplicado": False}


def listar_conversaciones_admin(estado=None, cursor_id=None, limite=50):
    if estado not in (None, "abierta", "atendida"):
        raise ValueError("estado no válido.")
    limite = max(1, min(int(limite), MAX_LISTADO))
    if cursor_id is not None:
        cursor_id = _uuid(cursor_id, "cursor_id")
    condiciones = []
    valores = []
    if estado is not None:
        condiciones.append("c.estado = %s")
        valores.append(estado)
    if cursor_id is not None:
        condiciones.append(
            "(c.updated_at, c.id) < (SELECT updated_at, id FROM public.conversaciones WHERE id = %s)"
        )
        valores.append(cursor_id)
    where = " WHERE " + " AND ".join(condiciones) if condiciones else ""
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            cursor.execute(
                f"""SELECT c.id, c.vehiculo_id, c.visitante_id, c.estado, c.created_at, c.updated_at,
                           v.marca, v.modelo, v.anio,
                           m.contenido AS ultimo_mensaje,
                           m.remitente AS ultimo_remitente,
                           m.created_at AS ultimo_mensaje_en
                    FROM public.conversaciones AS c
                    JOIN public.vehiculos AS v ON v.id = c.vehiculo_id
                    LEFT JOIN LATERAL (
                        SELECT contenido, remitente, created_at FROM public.mensajes_chat
                        WHERE conversacion_id = c.id ORDER BY id DESC LIMIT 1
                    ) AS m ON true{where}
                    ORDER BY c.updated_at DESC, c.id DESC LIMIT %s""",
                (*valores, limite),
            )
            return [_fila(fila) for fila in cursor.fetchall()]


def obtener_conversacion(conversacion_id, visitante_id=None, admin=False):
    conversacion_id = _uuid(conversacion_id, "conversacion_id")
    if not admin and visitante_id is None:
        return None
    condiciones = ["c.id = %s"]
    valores = [conversacion_id]
    if not admin:
        condiciones.append("c.visitante_id = %s")
        valores.append(_uuid(visitante_id, "visitante_id"))
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            # Distingue conversación propia vacía ([] de mensajes nuevos) de un
            # ID inexistente o ajeno (None), con la misma consulta de propiedad.
            if admin:
                cursor.execute(
                    "SELECT 1 FROM public.conversaciones WHERE id = %s",
                    (conversacion_id,),
                )
            else:
                cursor.execute(
                    "SELECT 1 FROM public.conversaciones WHERE id = %s AND visitante_id = %s",
                    (conversacion_id, _uuid(visitante_id, "visitante_id")),
                )
            if cursor.fetchone() is None:
                return None
            cursor.execute(
                """SELECT c.*, v.marca, v.modelo, v.anio
                   FROM public.conversaciones AS c
                   JOIN public.vehiculos AS v ON v.id = c.vehiculo_id
                   WHERE """ + " AND ".join(condiciones), tuple(valores),
            )
            return _fila(cursor.fetchone())


def listar_mensajes(conversacion_id, despues_de_id=0, visitante_id=None, admin=False):
    conversacion_id = _uuid(conversacion_id, "conversacion_id")
    if not admin and visitante_id is None:
        return None
    valores = [conversacion_id]
    ownership = ""
    if not admin:
        ownership = " AND visitante_id = %s"
        valores.append(_uuid(visitante_id, "visitante_id"))
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            cursor.execute(
                "SELECT id FROM public.conversaciones WHERE id = %s" + ownership,
                tuple(valores),
            )
            if cursor.fetchone() is None:
                return None
            cursor.execute(
                """SELECT m.id, m.conversacion_id, m.remitente, m.contenido, m.created_at
                   FROM public.mensajes_chat AS m
                   WHERE m.conversacion_id = %s AND m.id > %s
                   ORDER BY m.id ASC LIMIT 200""",
                (conversacion_id, int(despues_de_id)),
            )
            return [_fila(fila) for fila in cursor.fetchall()]


def responder_admin(conversacion_id, clave_idempotencia, huella, contenido):
    conversacion_id = _uuid(conversacion_id, "conversacion_id")
    clave, huella, contenido = _validar_mensaje(clave_idempotencia, huella, contenido)
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            existente = _mensaje_existente(
                cursor, clave, huella, "administrador", conversacion_id=conversacion_id,
            )
            if existente is not None:
                return {"mensaje": existente["mensaje"], "duplicado": True}
            cursor.execute("SELECT id FROM public.conversaciones WHERE id = %s FOR UPDATE", (conversacion_id,))
            if cursor.fetchone() is None:
                return None
            cursor.execute(
                """INSERT INTO public.mensajes_chat
                   (conversacion_id, remitente, contenido, clave_idempotencia, huella_solicitud)
                   VALUES (%s, 'administrador', %s, %s, %s) RETURNING *""",
                (conversacion_id, contenido, clave, huella),
            )
            guardado = cursor.fetchone()
            mensaje = _fila({campo: guardado[campo] for campo in (
                "id", "conversacion_id", "remitente", "contenido", "created_at",
            )})
            cursor.execute(
                "UPDATE public.conversaciones SET updated_at = now() WHERE id = %s",
                (conversacion_id,),
            )
            return {"mensaje": mensaje, "duplicado": False}


def marcar_atendida(conversacion_id):
    conversacion_id = _uuid(conversacion_id, "conversacion_id")
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            cursor.execute(
                """UPDATE public.conversaciones SET estado = 'atendida', updated_at = now()
                   WHERE id = %s RETURNING *""",
                (conversacion_id,),
            )
            return _fila(cursor.fetchone())
