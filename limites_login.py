"""Limitación de acceso compartida y atómica en PostgreSQL, independiente de cookies."""

from persistencia import _conectar


def reservar_intento_login(clave, max_intentos=5, ventana_segundos=600):
    """Reserva antes del hash; devuelve segundos de espera o cero si se permite."""
    if not isinstance(clave, str) or not 1 <= len(clave) <= 128:
        raise ValueError("La clave del limitador no es válida.")
    if not 1 <= max_intentos <= 1000 or not 1 <= ventana_segundos <= 86400:
        raise ValueError("La ventana del limitador no es válida.")
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            # Limpieza acotada de ventanas antiguas: no requiere cron ni otro servicio.
            cursor.execute(
                "DELETE FROM public.admin_login_intentos WHERE clave IN "
                "(SELECT clave FROM public.admin_login_intentos "
                "WHERE expira_en < clock_timestamp() - interval '1 day' "
                "ORDER BY expira_en LIMIT 100)"
            )
            cursor.execute(
                """INSERT INTO public.admin_login_intentos (clave, intentos, expira_en)
                VALUES (%s, 1, clock_timestamp() + %s * interval '1 second')
                ON CONFLICT (clave) DO UPDATE SET
                    intentos = CASE WHEN admin_login_intentos.expira_en <= clock_timestamp()
                        THEN 1 ELSE LEAST(admin_login_intentos.intentos + 1, %s + 1) END,
                    expira_en = CASE WHEN admin_login_intentos.expira_en <= clock_timestamp()
                        THEN clock_timestamp() + %s * interval '1 second'
                        ELSE admin_login_intentos.expira_en END
                RETURNING intentos,
                    GREATEST(1, CEIL(EXTRACT(EPOCH FROM (expira_en - clock_timestamp()))))::integer AS espera""",
                (clave, ventana_segundos, max_intentos, ventana_segundos),
            )
            fila = cursor.fetchone()
    return fila["espera"] if fila["intentos"] > max_intentos else 0


def reiniciar_intentos_login(clave):
    """Una autenticación válida libera la ventana de ese origen."""
    with _conectar() as conexion:
        with conexion.cursor() as cursor:
            cursor.execute("DELETE FROM public.admin_login_intentos WHERE clave = %s", (clave,))
