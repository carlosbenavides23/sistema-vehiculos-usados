"""Metadatos y coordinación durable entre PostgreSQL y Supabase Storage.

La subida se reserva antes de enviar bytes. Confirmar cambia la referencia y
encola el objeto anterior en una sola transacción. La cola nunca entrega rutas
activas ni reservas recientes: un fallo de Storage solo puede dejar un objeto
sin referencia pendiente de limpieza, sin perder la foto anterior.
"""

import re
import uuid

from persistencia import _conectar


CAMPOS = "id, vehiculo_id, storage_path, orden, mime_type, size_bytes, width_px, height_px, created_at"


def _normalizar_fila(fila):
    if fila is None:
        return None
    resultado = dict(fila)
    fecha = resultado.get("created_at")
    if hasattr(fecha, "isoformat"):
        resultado["created_at"] = fecha.isoformat()
    return resultado


def _clave(valor):
    return str(uuid.UUID(str(valor)))


def _huella(valor):
    if not isinstance(valor, str) or not re.fullmatch(r"[0-9a-f]{64}", valor):
        raise ValueError("La huella de la fotografía no es válida.")
    return valor


def _bloquear(cursor, vehiculo_id, clave=None):
    if clave:
        # El mismo UUID en dos vehículos no puede reservar dos operaciones.
        bloqueo = uuid.UUID(clave).int & ((1 << 63) - 1)
        cursor.execute("SELECT pg_advisory_xact_lock(%s)", (bloqueo,))
    cursor.execute("SELECT id FROM public.vehiculos WHERE id = %s FOR UPDATE", (vehiculo_id,))
    if cursor.fetchone() is None:
        raise LookupError("No se encontró el vehículo.")


def _leer_operacion(cursor, clave, bloqueo=False):
    cursor.execute(
        "SELECT *, created_at > now() - interval '1 hour' AS vigente "
        "FROM public.fotografia_operaciones WHERE clave = %s" + (" FOR UPDATE" if bloqueo else ""),
        (clave,),
    )
    return cursor.fetchone()


def _comprobar_operacion(operacion, vehiculo_id, fotografia_id, huella=None):
    if operacion["vehiculo_id"] != vehiculo_id or operacion["fotografia_objetivo"] != fotografia_id:
        raise ValueError("La clave de solicitud ya corresponde a otra operación.")
    if huella is not None and operacion["huella"] != huella:
        raise ValueError("La clave de solicitud ya se usó con otra fotografía.")
    if operacion["estado"] == "cancelada":
        raise ValueError("La subida anterior se canceló. Selecciona la fotografía de nuevo.")
    if operacion["estado"] == "pendiente" and not operacion["vigente"]:
        raise ValueError("La subida anterior expiró. Selecciona la fotografía de nuevo.")


def _foto_resultado(cursor, operacion):
    cursor.execute(
        f"SELECT {CAMPOS} FROM public.vehiculo_fotografias WHERE id = %s AND storage_path = %s",
        (operacion["fotografia_resultado"], operacion["storage_path"]),
    )
    fila = cursor.fetchone()
    if fila is None:
        raise ValueError("La fotografía ya cambió después de esa solicitud. Actualiza el catálogo.")
    return _normalizar_fila(fila)


def listar_fotografias(vehiculo_id):
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            cursor.execute(
                f"SELECT {CAMPOS} FROM public.vehiculo_fotografias WHERE vehiculo_id = %s ORDER BY orden",
                (vehiculo_id,),
            )
            return [_normalizar_fila(fila) for fila in cursor.fetchall()]


def listar_por_vehiculos(identificadores):
    resultado = {identificador: [] for identificador in identificadores}
    if not resultado:
        return resultado
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            cursor.execute(
                f"SELECT {CAMPOS} FROM public.vehiculo_fotografias WHERE vehiculo_id = ANY(%s) ORDER BY vehiculo_id, orden",
                (list(resultado),),
            )
            for fila in cursor.fetchall():
                resultado[fila["vehiculo_id"]].append(_normalizar_fila(fila))
    return resultado


def obtener_fotografia(vehiculo_id, fotografia_id):
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            cursor.execute(
                f"SELECT {CAMPOS} FROM public.vehiculo_fotografias WHERE vehiculo_id = %s AND id = %s",
                (vehiculo_id, fotografia_id),
            )
            return _normalizar_fila(cursor.fetchone())


def buscar_solicitud(clave, vehiculo_id, foto_id=None, huella_sha256=None):
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            operacion = _leer_operacion(cursor, _clave(clave))
            if operacion is None:
                return None
            _comprobar_operacion(operacion, vehiculo_id, foto_id, huella_sha256)
            return _foto_resultado(cursor, operacion) if operacion["estado"] == "completada" else None


def preparar_subida(vehiculo_id, clave_solicitud, huella_sha256, fotografia_id=None):
    """Reserva un objeto y su recuperación antes de tocar Storage."""
    clave = _clave(clave_solicitud)
    huella = _huella(huella_sha256)
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            _bloquear(cursor, vehiculo_id, clave)
            anterior = _leer_operacion(cursor, clave, bloqueo=True)
            if anterior:
                _comprobar_operacion(anterior, vehiculo_id, fotografia_id, huella)
                respuesta = {"storage_path": anterior["storage_path"], "completada": anterior["estado"] == "completada"}
                if respuesta["completada"]:
                    respuesta["fotografia"] = _foto_resultado(cursor, anterior)
                return respuesta

            anterior_path = None
            if fotografia_id is not None:
                cursor.execute(
                    "SELECT storage_path FROM public.vehiculo_fotografias WHERE vehiculo_id = %s AND id = %s",
                    (vehiculo_id, fotografia_id),
                )
                foto = cursor.fetchone()
                if foto is None:
                    raise LookupError("No se encontró la fotografía.")
                anterior_path = foto["storage_path"]
            else:
                cursor.execute(
                    "SELECT (SELECT count(*) FROM public.vehiculo_fotografias WHERE vehiculo_id = %s) + "
                    "(SELECT count(*) FROM public.fotografia_operaciones WHERE vehiculo_id = %s "
                    "AND fotografia_objetivo IS NULL AND estado = 'pendiente' "
                    "AND created_at > now() - interval '1 hour') AS total",
                    (vehiculo_id, vehiculo_id),
                )
                if cursor.fetchone()["total"] >= 5:
                    raise ValueError("Se permiten hasta cinco fotografías por vehículo.")

            ruta = f"{vehiculo_id}/{uuid.UUID(clave).hex}.webp"
            cursor.execute(
                "INSERT INTO public.fotografia_operaciones "
                "(clave, vehiculo_id, fotografia_objetivo, anterior_path, storage_path, huella) "
                "VALUES (%s, %s, %s, %s, %s, %s)",
                (clave, vehiculo_id, fotografia_id, anterior_path, ruta, huella),
            )
            cursor.execute(
                "INSERT INTO public.storage_limpieza (storage_path, disponible_desde) "
                "VALUES (%s, now() + interval '1 hour')",
                (ruta,),
            )
    return {"storage_path": ruta, "completada": False}


def guardar_fotografia(vehiculo_id, metadatos, clave_solicitud, fotografia_id=None):
    """Se llama después de subir el objeto nuevo; nunca borra el anterior."""
    clave = _clave(clave_solicitud)
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            _bloquear(cursor, vehiculo_id, clave)
            operacion = _leer_operacion(cursor, clave, bloqueo=True)
            if operacion is None:
                raise ValueError("La subida debe reservarse antes de confirmarse.")
            _comprobar_operacion(operacion, vehiculo_id, fotografia_id)
            if operacion["storage_path"] != metadatos.get("storage_path"):
                raise ValueError("La ruta no coincide con la reserva de subida.")
            if operacion["estado"] == "completada":
                return _foto_resultado(cursor, operacion)

            valores = tuple(metadatos[campo] for campo in ("storage_path", "mime_type", "size_bytes", "width_px", "height_px"))
            if fotografia_id is None:
                cursor.execute("SELECT orden FROM public.vehiculo_fotografias WHERE vehiculo_id = %s", (vehiculo_id,))
                ocupados = {fila["orden"] for fila in cursor.fetchall()}
                orden = next((numero for numero in range(1, 6) if numero not in ocupados), None)
                if orden is None:
                    raise ValueError("Se permiten hasta cinco fotografías por vehículo.")
                cursor.execute(
                    "INSERT INTO public.vehiculo_fotografias "
                    "(vehiculo_id, orden, storage_path, mime_type, size_bytes, width_px, height_px) "
                    f"VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING {CAMPOS}",
                    (vehiculo_id, orden, *valores),
                )
            else:
                cursor.execute(
                    "UPDATE public.vehiculo_fotografias SET storage_path = %s, mime_type = %s, "
                    "size_bytes = %s, width_px = %s, height_px = %s "
                    f"WHERE vehiculo_id = %s AND id = %s AND storage_path = %s RETURNING {CAMPOS}",
                    (*valores, vehiculo_id, fotografia_id, operacion["anterior_path"]),
                )
            guardada = cursor.fetchone()
            if guardada is None:
                raise ValueError("La fotografía cambió durante la subida. Actualiza el catálogo.")
            cursor.execute("DELETE FROM public.storage_limpieza WHERE storage_path = %s", (operacion["storage_path"],))
            if operacion["anterior_path"]:
                cursor.execute(
                    "INSERT INTO public.storage_limpieza (storage_path) VALUES (%s) "
                    "ON CONFLICT (storage_path) DO UPDATE SET disponible_desde = now()",
                    (operacion["anterior_path"],),
                )
            cursor.execute(
                "UPDATE public.fotografia_operaciones SET estado = 'completada', fotografia_resultado = %s WHERE clave = %s",
                (guardada["id"], clave),
            )
            return _normalizar_fila(guardada)


def cancelar_subida(storage_path):
    """Fallar no afecta una referencia que otro reintento ya haya confirmado."""
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            cursor.execute("SELECT estado FROM public.fotografia_operaciones WHERE storage_path = %s FOR UPDATE", (storage_path,))
            fila = cursor.fetchone()
            if fila is None or fila["estado"] == "completada":
                return
            cursor.execute("SELECT id FROM public.vehiculo_fotografias WHERE storage_path = %s", (storage_path,))
            if cursor.fetchone() is not None:
                return
            cursor.execute("UPDATE public.fotografia_operaciones SET estado = 'cancelada' WHERE storage_path = %s", (storage_path,))
            cursor.execute(
                "INSERT INTO public.storage_limpieza (storage_path) VALUES (%s) "
                "ON CONFLICT (storage_path) DO UPDATE SET disponible_desde = now()",
                (storage_path,),
            )


def eliminar_fotografia(vehiculo_id, fotografia_id):
    """Retira la referencia y guarda el trabajo de limpieza en el mismo commit."""
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            _bloquear(cursor, vehiculo_id)
            cursor.execute(
                "DELETE FROM public.vehiculo_fotografias WHERE vehiculo_id = %s AND id = %s RETURNING storage_path",
                (vehiculo_id, fotografia_id),
            )
            fila = cursor.fetchone()
            if fila is None:
                return False
            cursor.execute(
                "INSERT INTO public.storage_limpieza (storage_path) VALUES (%s) "
                "ON CONFLICT (storage_path) DO UPDATE SET disponible_desde = now()",
                (fila["storage_path"],),
            )
    return True


def pendientes_limpieza(limite=10):
    """Consulta candidatos sin mutar; reclamar_limpieza autoriza cada borrado real."""
    if not isinstance(limite, int) or not 1 <= limite <= 100:
        raise ValueError("Límite de limpieza no válido.")
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            cursor.execute(
                "SELECT cola.storage_path AS id, cola.storage_path FROM public.storage_limpieza cola "
                "WHERE cola.disponible_desde <= now() "
                "AND (cola.reclamada_hasta IS NULL OR cola.reclamada_hasta <= now()) "
                "AND NOT EXISTS (SELECT 1 FROM public.vehiculo_fotografias foto WHERE foto.storage_path = cola.storage_path) "
                "AND NOT EXISTS (SELECT 1 FROM public.fotografia_operaciones op WHERE op.storage_path = cola.storage_path "
                "AND op.estado = 'pendiente' AND op.created_at > now() - interval '1 hour') "
                "ORDER BY cola.disponible_desde LIMIT %s",
                (limite,),
            )
            return [dict(fila) for fila in cursor.fetchall()]


def reclamar_limpieza(identificador):
    """Impide confirmar una referencia durante el borrado; lease de dos minutos.

    El orden op->cola coincide con guardar/cancelar. SKIP LOCKED hace que un
    guardado en vuelo gane: nunca se autoriza limpiar su objeto con una lectura
    de expiración anterior. Tras el commit, una reserva cancelada no puede volver
    a confirmar y una ruta completada no se puede reutilizar.
    """
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            cursor.execute(
                "SELECT estado, created_at <= clock_timestamp() - interval '1 hour' AS expirada "
                "FROM public.fotografia_operaciones WHERE storage_path = %s FOR UPDATE SKIP LOCKED",
                (identificador,),
            )
            operacion = cursor.fetchone()
            if operacion is None:
                cursor.execute("SELECT 1 FROM public.fotografia_operaciones WHERE storage_path = %s", (identificador,))
                if cursor.fetchone() is not None:
                    return False  # Otro worker o un guardado tiene la operación.
            elif operacion["estado"] == "pendiente" and not operacion["expirada"]:
                return False

            cursor.execute(
                "SELECT storage_path FROM public.storage_limpieza WHERE storage_path = %s "
                "AND disponible_desde <= clock_timestamp() "
                "AND (reclamada_hasta IS NULL OR reclamada_hasta <= clock_timestamp()) FOR UPDATE SKIP LOCKED",
                (identificador,),
            )
            if cursor.fetchone() is None:
                return False
            cursor.execute("SELECT 1 FROM public.vehiculo_fotografias WHERE storage_path = %s", (identificador,))
            if cursor.fetchone() is not None:
                return False
            if operacion and operacion["estado"] == "pendiente":
                cursor.execute(
                    "UPDATE public.fotografia_operaciones SET estado = 'cancelada' WHERE storage_path = %s",
                    (identificador,),
                )
            cursor.execute(
                "UPDATE public.storage_limpieza SET reclamada_hasta = clock_timestamp() + interval '2 minutes' WHERE storage_path = %s",
                (identificador,),
            )
    return True


def confirmar_limpieza(identificador):
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            cursor.execute(
                "DELETE FROM public.storage_limpieza cola WHERE storage_path = %s "
                "AND NOT EXISTS (SELECT 1 FROM public.vehiculo_fotografias foto WHERE foto.storage_path = cola.storage_path)",
                (identificador,),
            )
            cursor.execute(
                "UPDATE public.fotografia_operaciones SET estado = 'cancelada' WHERE storage_path = %s "
                "AND estado = 'pendiente' AND created_at <= now() - interval '1 hour'",
                (identificador,),
            )
