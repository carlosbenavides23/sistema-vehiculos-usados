"""Consultas parametrizadas de PostgreSQL para el catálogo de vehículos."""

from collections import Counter
import hashlib
import json
import os
import uuid

from vehiculos import MAX_VEHICULOS


CAMPOS_DATOS = (
    "marca", "modelo", "anio", "kilometraje", "precio_centavos", "ubicacion",
    "descripcion", "disponibilidad", "color", "placa", "tipo_vehiculo",
    "transmision", "combustible", "aire_acondicionado", "ventanas_electricas",
    "pantalla_multimedia",
)
CAMPOS_SALIDA = ("id", *CAMPOS_DATOS, "created_at", "updated_at")
SELECCION = ", ".join(CAMPOS_SALIDA)


def _conectar():
    dsn = os.environ.get("DATABASE_URL", "").strip()
    if not dsn:
        raise RuntimeError("DATABASE_URL no está configurada.")

    import psycopg
    from psycopg.conninfo import conninfo_to_dict
    from psycopg.rows import dict_row

    parametros = conninfo_to_dict(dsn)
    # La excepción sin TLS es explícita y solo permite una base de pruebas loopback.
    local_permitido = os.environ.get("ALLOW_LOCAL_DATABASE", "").lower() == "true"
    hosts_locales = ("127.0.0.1", "::1", "localhost")
    host_local = (
        parametros.get("host") in hosts_locales
        and parametros.get("hostaddr", "127.0.0.1") in ("127.0.0.1", "::1")
        and not parametros.get("service") and not os.environ.get("PGSERVICE")
    )
    parametros["sslmode"] = "disable" if local_permitido and host_local else "require"
    if local_permitido and host_local:
        # Evita que PGHOSTADDR u otra configuración redirija el opt-in sin TLS.
        parametros["hostaddr"] = "::1" if parametros["host"] == "::1" else "127.0.0.1"
    parametros["connect_timeout"] = 5
    # Supavisor transaction mode no admite prepared statements persistentes.
    parametros["prepare_threshold"] = None
    return psycopg.connect(**parametros, row_factory=dict_row)


def _normalizar_fecha(valor):
    if hasattr(valor, "isoformat"):
        return valor.isoformat()
    return valor


def _normalizar_fila(fila):
    if fila is None:
        return None
    resultado = dict(fila)
    for campo in ("created_at", "updated_at"):
        resultado[campo] = _normalizar_fecha(resultado.get(campo))
    return resultado


def listar_vehiculos():
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            cursor.execute(f"SELECT {SELECCION} FROM public.vehiculos ORDER BY id")
            return [_normalizar_fila(fila) for fila in cursor.fetchall()]


def buscar_vehiculos(filtros):
    """Consulta el catálogo con filtros normalizados y valores parametrizados."""
    condiciones = []
    valores = []

    consulta = filtros.get("q")
    if consulta:
        # Cada palabra debe aparecer en al menos un campo descriptivo. position()
        # evita tratar los caracteres % y _ como comodines de LIKE.
        campos_busqueda = (
            "marca", "modelo", "descripcion", "ubicacion", "tipo_vehiculo",
            "color", "transmision", "combustible",
        )
        expresion_texto = "lower(concat_ws(' ', " + ", ".join(campos_busqueda) + "))"
        for palabra in consulta.casefold().split():
            condiciones.append(f"position(lower(%s) in {expresion_texto}) > 0")
            valores.append(palabra)

    if filtros.get("disponibilidad") is not None:
        condiciones.append("disponibilidad = %s")
        valores.append(filtros["disponibilidad"])
    for campo, columna in (("precio_min", "precio_centavos"), ("anio_min", "anio")):
        if filtros.get(campo) is not None:
            condiciones.append(f"{columna} >= %s")
            valores.append(filtros[campo])
    for campo, columna in (("precio_max", "precio_centavos"), ("anio_max", "anio")):
        if filtros.get(campo) is not None:
            condiciones.append(f"{columna} <= %s")
            valores.append(filtros[campo])

    tipo = filtros.get("tipo_vehiculo")
    if tipo:
        condiciones.append("lower(tipo_vehiculo) = lower(%s)")
        valores.append(tipo)

    where = " WHERE " + " AND ".join(condiciones) if condiciones else ""
    ordenes = {
        "precio_asc": "precio_centavos ASC, id ASC",
        "precio_desc": "precio_centavos DESC, id ASC",
        "anio_asc": "anio ASC, id ASC",
        "anio_desc": "anio DESC, id ASC",
    }
    orden = ordenes.get(filtros.get("orden"), "id ASC")

    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            cursor.execute(
                f"SELECT {SELECCION} FROM public.vehiculos{where} ORDER BY {orden}",
                tuple(valores),
            )
            return [_normalizar_fila(fila) for fila in cursor.fetchall()]


def obtener_vehiculo(identificador):
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            cursor.execute(
                f"SELECT {SELECCION} FROM public.vehiculos WHERE id = %s",
                (identificador,),
            )
            return _normalizar_fila(cursor.fetchone())


def crear_vehiculo(datos, clave_solicitud=None):
    """Inserta una fila y deja que IDENTITY asigne el identificador."""
    clave = str(uuid.UUID(str(clave_solicitud))) if clave_solicitud is not None else None
    huella = hashlib.sha256(json.dumps(
        {campo: datos[campo] for campo in CAMPOS_DATOS},
        sort_keys=True, ensure_ascii=False, separators=(",", ":"),
    ).encode("utf-8")).hexdigest() if clave else None
    columnas = ", ".join(CAMPOS_DATOS)
    marcadores = ", ".join(["%s"] * len(CAMPOS_DATOS))
    valores = tuple(datos[campo] for campo in CAMPOS_DATOS)
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            # Serializa altas para conservar el límite histórico de 500 registros.
            cursor.execute("LOCK TABLE public.vehiculos IN SHARE ROW EXCLUSIVE MODE")
            if clave:
                cursor.execute(
                    "SELECT huella, vehiculo_id FROM public.solicitudes_idempotentes WHERE clave = %s",
                    (clave,),
                )
                anterior = cursor.fetchone()
                if anterior:
                    if anterior["huella"] != huella:
                        raise ValueError("La clave de solicitud ya se usó con otros datos.")
                    cursor.execute(
                        f"SELECT {SELECCION} FROM public.vehiculos WHERE id = %s",
                        (anterior["vehiculo_id"],),
                    )
                    return _normalizar_fila(cursor.fetchone())
            cursor.execute("SELECT COUNT(*) AS total FROM public.vehiculos")
            if cursor.fetchone()["total"] >= MAX_VEHICULOS:
                return None
            cursor.execute(
                f"INSERT INTO public.vehiculos ({columnas}) VALUES ({marcadores}) "
                f"RETURNING {SELECCION}",
                valores,
            )
            guardado = _normalizar_fila(cursor.fetchone())
            if clave:
                cursor.execute(
                    "INSERT INTO public.solicitudes_idempotentes (clave, huella, vehiculo_id) VALUES (%s, %s, %s)",
                    (clave, huella, guardado["id"]),
                )
            return guardado


def crear_vehiculo_idempotente(datos, clave):
    """Una clave UUID repetida no crea otro anuncio; un cuerpo distinto se rechaza."""
    return crear_vehiculo(datos, clave_solicitud=str(uuid.UUID(str(clave))))


def editar_vehiculo(identificador, datos):
    asignaciones = ", ".join(f"{campo} = %s" for campo in CAMPOS_DATOS)
    valores = tuple(datos[campo] for campo in CAMPOS_DATOS)
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            cursor.execute(
                f"UPDATE public.vehiculos SET {asignaciones}, updated_at = now() "
                f"WHERE id = %s RETURNING {SELECCION}",
                (*valores, identificador),
            )
            return _normalizar_fila(cursor.fetchone())


def cambiar_disponibilidad(identificador, disponibilidad):
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            cursor.execute(
                f"UPDATE public.vehiculos SET disponibilidad = %s, updated_at = now() "
                f"WHERE id = %s RETURNING {SELECCION}",
                (disponibilidad, identificador),
            )
            return _normalizar_fila(cursor.fetchone())


def _firma(datos):
    return tuple(datos.get(campo) for campo in CAMPOS_DATOS)


def cargar_demo_si_vacio(vehiculos):
    """Carga seis seeds si la tabla está vacía; reconoce una carga exacta previa."""
    esperados = [_firma(datos) for datos in vehiculos]
    if len(esperados) != 6 or len(set(esperados)) != 6:
        raise ValueError("El conjunto de demostración debe contener seis vehículos únicos.")

    columnas = ", ".join(CAMPOS_DATOS)
    marcadores = ", ".join(["%s"] * len(CAMPOS_DATOS))
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            cursor.execute("LOCK TABLE public.vehiculos IN SHARE ROW EXCLUSIVE MODE")
            cursor.execute(f"SELECT {SELECCION} FROM public.vehiculos ORDER BY id")
            existentes = cursor.fetchall()
            if existentes:
                firmas = [_firma(fila) for fila in existentes]
                if len(firmas) == 6 and Counter(firmas) == Counter(esperados):
                    return False
                raise ValueError(
                    "La tabla no está vacía y no coincide exactamente con la demostración; "
                    "no se modificaron datos existentes."
                )
            for datos in vehiculos:
                cursor.execute(
                    f"INSERT INTO public.vehiculos ({columnas}) VALUES ({marcadores})",
                    _firma(datos),
                )
    return True


def importar_legacy_si_nuevo(vehiculos, aplicar=False):
    """Previsualiza o importa exports antiguos; omite coincidencias exactas."""
    if not vehiculos:
        return {"candidatos": 0, "insertados": 0, "omitidos": 0, "modo": "aplicado" if aplicar else "previsualización"}
    firmas = [_firma(datos) for datos in vehiculos]
    if len(set(firmas)) != len(firmas):
        raise ValueError("El export contiene vehículos idénticos; reconcilia los duplicados primero.")

    columnas = ", ".join(CAMPOS_DATOS)
    marcadores = ", ".join(["%s"] * len(CAMPOS_DATOS))
    insertados = 0
    omitidos = 0
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            if aplicar:
                cursor.execute("LOCK TABLE public.vehiculos IN SHARE ROW EXCLUSIVE MODE")
            cursor.execute(f"SELECT {SELECCION} FROM public.vehiculos ORDER BY id")
            filas_existentes = cursor.fetchall()
            existentes = {_firma(fila) for fila in filas_existentes}
            nuevos = sum(firma not in existentes for firma in firmas)
            if len(filas_existentes) + nuevos > MAX_VEHICULOS:
                raise ValueError(f"La importación superaría el límite de {MAX_VEHICULOS} vehículos.")
            for datos, firma in zip(vehiculos, firmas):
                if firma in existentes:
                    omitidos += 1
                    continue
                insertados += 1
                if aplicar:
                    cursor.execute(
                        f"INSERT INTO public.vehiculos ({columnas}) VALUES ({marcadores})",
                        firma,
                    )
                    existentes.add(firma)
    return {
        "candidatos": insertados,
        "insertados": insertados if aplicar else 0,
        "omitidos": omitidos,
        "modo": "aplicado" if aplicar else "previsualización",
    }


def _clave_catalogo(datos):
    """Identidad estable del anuncio para que reimportar no cree otra unidad."""
    return (
        datos["marca"].strip().casefold(),
        datos["modelo"].strip().casefold(),
        datos["anio"],
    )


def importar_catalogo_si_nuevo(vehiculos, aplicar=False):
    """Importa solo marcas/modelos/años aún ausentes; por defecto solo previsualiza."""
    if not vehiculos:
        return {"candidatos": 0, "insertados": 0, "omitidos": 0,
                "modo": "aplicado" if aplicar else "previsualización"}

    claves = [_clave_catalogo(datos) for datos in vehiculos]
    if len(set(claves)) != len(claves):
        raise ValueError("La importación contiene vehículos con la misma marca, modelo y año.")

    columnas = ", ".join(CAMPOS_DATOS)
    marcadores = ", ".join(["%s"] * len(CAMPOS_DATOS))
    insertados = 0
    omitidos = 0
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            if aplicar:
                cursor.execute("LOCK TABLE public.vehiculos IN SHARE ROW EXCLUSIVE MODE")
            cursor.execute(f"SELECT {SELECCION} FROM public.vehiculos ORDER BY id")
            filas_existentes = cursor.fetchall()
            existentes = {_clave_catalogo(fila) for fila in filas_existentes}
            nuevos = sum(clave not in existentes for clave in claves)
            if len(filas_existentes) + nuevos > MAX_VEHICULOS:
                raise ValueError(f"La importación superaría el límite de {MAX_VEHICULOS} vehículos.")

            for datos, clave in zip(vehiculos, claves):
                if clave in existentes:
                    omitidos += 1
                    continue
                insertados += 1
                if aplicar:
                    valores = tuple(datos[campo] for campo in CAMPOS_DATOS)
                    cursor.execute(
                        f"INSERT INTO public.vehiculos ({columnas}) VALUES ({marcadores})",
                        valores,
                    )
                    existentes.add(clave)

    return {
        "candidatos": insertados,
        "insertados": insertados if aplicar else 0,
        "omitidos": omitidos,
        "modo": "aplicado" if aplicar else "previsualización",
    }
