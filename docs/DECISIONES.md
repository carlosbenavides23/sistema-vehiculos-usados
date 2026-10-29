# Decisiones y cuestiones pendientes

## Implementación integral — 29 de octubre de 2026

| Decisión | Motivo |
| --- | --- |
| PostgreSQL 17/Supabase como fuente de verdad, Flask como única API de datos | Catálogo compartido y autorización de escrituras comprensible para Programación Estructurada. |
| Funciones Python y psycopg, sin ORM | Separar validación, acceso a datos, seguridad y adaptación HTTP con pocos módulos. |
| USD en centavos e IDs BIGINT IDENTITY seguros para JavaScript | Conserva formato y evita IDs asignados por navegadores o errores de punto flotante. |
| Opcionales y booleanos triestado | No convertir características no informadas en falsas ni inferirlas desde descripciones. |
| Placa administrativa | No se entrega públicamente. Una placa visible en una fotografía necesita ocultarse antes de subirla. |
| Cinco fotos, originales de 10 MB y WebP ≤1 MB/1600 px | Mantiene el bucket existente y permite solicitudes individuales por debajo del límite de funciones Vercel. |
| Validación y recodificación en Python además del navegador | No confiar en MIME, extensión ni código del cliente; eliminar metadatos y rechazar animaciones/corrupción. |
| Objetos nuevos sin upsert y coordinación durable | Conservar foto anterior hasta commit, recuperar objetos sin referencia y evitar pérdida ante fallos parciales. |
| Limpieza reclamada bajo bloqueo, con cancelación de reservas vencidas y concesión de dos minutos | Evitar que el limpiador borre un objeto que otra transacción está confirmando. Previsualizar no modifica datos. |
| UUID y huella de contenido para altas/cargas | Evitar duplicados tras doble clic, respuesta perdida o reintentos; rechazar reuso con contenido distinto. |
| Administrador compartido Flask, scrypt y CSRF | Prototipo académico sencillo. No proporciona cuentas individuales, MFA ni atribución de cambios. |
| Límite de intentos en PostgreSQL | Compartido entre procesos, no reiniciable al borrar cookies, sin infraestructura de pago adicional. |
| RLS sin políticas públicas y privilegios revocados | La lectura pública pasa por Flask. No habilitar acceso directo solo para eliminar avisos INFO. |
| Preview siempre de consulta | Impedir que una Preview escriba sobre los seis registros de producción por un error de configuración. |
| Dependencias directas fijadas | Reproducir Flask, psycopg, dotenv y Pillow comprobados; no introducir un framework frontend. |

## Seguridad y operación

La limitación por HMAC de remote_addr puede agrupar a usuarios detrás de un proxy; es una protección conservadora, no una identidad. No se confía en cabeceras reenviadas arbitrarias. La administración debe evolucionar a cuentas individuales si se amplían usuarios o exposición. Rotar FLASK_SECRET_KEY invalida las sesiones; no se publican claves ni contraseñas.

Las fotos son públicas en el bucket existente. No se agregó reconocimiento de rostros o placas: el equipo revisa el contenido antes de subirlo. Una cola durable recupera fallos de Storage, pero necesita reintentos de mantenimiento; no se activó cron ni servicio externo de pago.

El esquema y las pruebas locales no equivalen a conexión Flask→Supabase o carga Storage remota. Esas comprobaciones dependen de credenciales locales configuradas y deben reportarse por separado. No se prueba escritura sobre los seis registros remotos. No se inventa éxito de un despliegue o de un servicio no ejecutado.

## Decisiones históricas

El segundo avance usaba localStorage versionado. La Fase 1 lo reemplazó por PostgreSQL; el valor vehiculos_demo_v1 queda intacto para exportación deliberada. Los seis registros ficticios siguen como conjunto inicial. Los nuevos campos no se rellenan interpretando sus descripciones.

La carga demo y la importación se ejecutan explícitamente, nunca al arrancar Flask. El importador previsualiza por defecto, asigna nuevos IDs y omite coincidencias exactas. No sobrescribe datos ni borra el navegador.

## Pendientes de decisión o autorización

1. Aclarar con el docente el significado de “poner números”. No se interpreta como una función nueva.
2. Definir alcance, responsable, criterios y evidencia de una posible validación técnica; no afirmar certificación mecánica.
3. Completar credenciales y verificar los servicios remotos sin usar los seis anuncios como datos de prueba.
4. Confirmar el acceso administrativo y la operación de limpieza antes de publicar.
5. Obtener aprobación para Production. Una Preview no autoriza promoción, push ni merge.
6. Confirmar presentaciones restantes y gestionar el fin de publicación previsto el 27 de noviembre, manteniendo la fecha académica del 30 de noviembre de 2026.

Cada ampliación debe actualizar arquitectura, contratos y evidencia. Búsqueda avanzada, precio máximo, chat, pagos, contacto real y cuentas completas permanecen fuera del alcance autorizado.
