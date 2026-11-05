# Cuarto avance — mensajería comprador-administrador

## Estado y alcance

El módulo se implementa en `feature/cuarto-avance-chat` como API Flask, persistencia PostgreSQL, HTML/CSS/JavaScript nativos y polling HTTP. El chat permanece **desactivado** (`CHAT_ENABLED=false`); Preview y cualquier ambiente de solo lectura lo fuerzan apagado. No se ejecutó la migración en Supabase ni se cambiaron variables de Vercel. No hay cuentas de compradores, WebSockets, Realtime, adjuntos ni notificaciones externas.

## Identidad y autorización

- En el primer contacto, Flask emite un secreto aleatorio de 256 bits en una cookie HttpOnly, SameSite=Lax, host-only, Path `/` y Secure en HTTPS. Expira en 30 días.
- PostgreSQL almacena únicamente el SHA-256 del secreto. Un verificador desconocido nunca crea identidad ni puede consultar conversaciones.
- La cookie anónima está separada de la sesión administrativa firmada. El login/logout del administrador no reasigna la propiedad del chat.
- Las mutaciones requieren CSRF. Los endpoints de comprador consultan propiedad en SQL en cada acceso. Conversación ajena o inexistente responde 404 genérico.
- Las tablas llevan RLS y privilegios directos revocados para `PUBLIC`, `anon` y `authenticated`. Flask es el único camino de acceso.
- Entradas limitadas a 2.000 caracteres en HTTP; la tabla admite hasta 4.000. Ocho mensajes por minuto por visitante se controlan dentro de una transacción bloqueada en PostgreSQL. UUID + huella rechaza reintentos con contenido cambiado y repite respuestas sin duplicar.
- Los mensajes se insertan como texto usando `textContent`; no se usa `innerHTML`, `localStorage` ni `sessionStorage` para credenciales.

## Persistencia y migración

`supabase/migrations/20261105103900_chat_anonimo.sql` crea `visitantes_anonimos`, `sesiones_visitante`, `conversaciones` y `mensajes_chat`; define claves foráneas, checks, índices, RLS y revocaciones. Al final incluye el rollback documentado en orden inverso. La conversación se crea transaccionalmente con el primer mensaje y existe como máximo una por visitante/vehículo. Las conversaciones evitan borrar el vehículo relacionado; los mensajes se eliminan en cascada si la conversación se elimina.

La migración está versionada y **no aplicada**. No se usó conexión Supabase ni se consultaron o cambiaron datos remotos. Antes de producción se requiere autorización explícita para aplicar DDL y validar privilegios sobre una instancia aislada primero.

## Matriz de regresión

| Caso | Verificación automatizada | Estado |
| --- | --- | --- |
| Chat apagado por defecto y en Preview | `tests/test_chat_api.py` | Aprobado |
| Identidad aleatoria, hash y expiración de 30 días | HTTP simulado aprobado; persistencia real en `tests/test_chat_persistencia.py` | Parcial: PostgreSQL omitido |
| Credencial desconocida no crea sesión | `tests/test_chat_api.py` | Aprobado |
| Inicio de sesión CSRF y cookie HttpOnly/SameSite | `tests/test_chat_api.py` | Aprobado |
| Inicio de conversación solo al primer mensaje | HTTP simulado; PostgreSQL real pendiente | Parcial |
| Reintento idempotente y cursor incremental | UI/API simulado; PostgreSQL real pendiente | Parcial |
| Propietario exclusivo; comprador B recibe denegación genérica | HTTP simulado; aislamiento real PostgreSQL pendiente | Parcial |
| Mensajes vacíos y exceso de longitud | `tests/test_chat_api.py` y validadores de persistencia | Aprobado |
| CSRF de comprador y administrador | `tests/test_chat_api.py` | Aprobado |
| Autenticación administrativa y marcar atendida | `tests/test_chat_api.py` | Aprobado |
| Límites concurrentes, persistencia y restricciones/ACL/RLS | `tests/test_chat_persistencia.py` | Pendiente: requiere `TEST_DATABASE_URL` PostgreSQL local aislado |
| Polling, cursor, pestaña oculta, no duplicación y XSS | `tests/test_chat_ui.mjs` | Aprobado por prueba de interfaz; falta flujo navegador con DB |
| Error de conexión y recuperación real | No reproducido aún en navegador con DB | Pendiente |
| Escritorio/móvil, recarga y flujos A/admin/B con dos contextos | Computer Use requiere servidor de prueba con PostgreSQL y contraseña admin de prueba | Pendiente |

## Evidencia de esta etapa

- Python: pruebas del chat HTTP/validación ejecutadas con repositorio simulado; 11 aprobadas.
- Integración PostgreSQL del chat: 7 omitidas, no aprobadas, porque `TEST_DATABASE_URL` no está configurada y este entorno no tiene servicio PostgreSQL local/dedicado detectado.
- Suite Python completa: 103 ejecutadas, 74 aprobadas y 29 omitidas (incluye integraciones que requieren PostgreSQL real).
- Node: `node --test tests/test_chat_ui.mjs`, 6/6 aprobadas.
- Sintaxis: `node --check` sobre ambos recursos JS del chat y `python -m compileall` sobre backend.
- Vercel: los recursos JS/CSS en `public/static/` se generan desde los originales mediante `scripts/preparar_vercel.py` y deben permanecer idénticos. La Preview de este PR no habilita el chat.
- Computer Use no se ejecutó para los flujos compradores/admin porque no hay una base aislada disponible; no se presentan capturas ni se atribuye a un fake la persistencia real.

## Retención y habilitación futura

La cookie vence en 30 días, pero conversaciones y mensajes no se purgan automáticamente en esta entrega. Antes de habilitar el chat público, el equipo debe aprobar un plazo de retención y un mecanismo de borrado que incluya los respaldos aplicables.

Pasos posteriores sujetos a autorización:

1. Probar la migración y rollback en PostgreSQL aislado con roles `anon`/`authenticated`.
2. Aprobar y aplicar el SQL en Supabase Production, verificando RLS y ausencia de privilegios Data API.
3. Definir la retención/eliminación de mensajes y sus responsables.
4. Configurar `CHAT_ENABLED=true` solo en Production; mantener Preview en solo lectura y con el chat apagado.
5. Verificar comprador A/admin/comprador B, polling, sesión expirada y despliegue de producción antes del anuncio público.
