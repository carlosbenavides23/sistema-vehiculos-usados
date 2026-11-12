# Auditoría integral V7 — 12 de noviembre de 2026

> **Actualización posterior:** V7-A01–V7-A05 están corregidos y verificados localmente. La auditoría original y sus evidencias se conservan abajo como registro del commit `6a7742e`. Véase «Cierre de correcciones» al final. Esta actualización no autoriza Production: sigue pendiente Supabase Auth real.

## Resumen ejecutivo

**Evaluación: NO APTO PARA PRODUCTION en el estado auditado.** Se confirmaron cinco defectos: **P0: 0, P1: 2, P2: 3, P3: 0**. No se demostró una vulnerabilidad de acceso cruzado del servidor ni escalamiento de rol. Sí se reprodujeron un bloqueo del flujo básico de mensajes, una excepción al aislamiento de Preview, pérdida de borradores, duplicación ante respuesta perdida y persistencia visual de datos de una cuenta anterior.

Rama auditada: `feat/v73-chat-cuentas`, commit `6a7742edcd06456d93c29f629231afb5dc876556`. GitHub confirmó abiertos los PR #20 (`b16dcef`, hacia main), #21 (`0c068fa`, hacia V7.1) y #22 (`6a7742e`, hacia V7.2). No se fusionó, publicó, desplegó ni corrigió código de aplicación durante esta auditoría. Se preservaron los cambios ajenos en AGENTS.md, artifacts/ e informes previos.

Las comprobaciones usaron Flask local, PostgreSQL 17 loopback con bases UUID desechables, cuatro identidades ficticias y dobles de Auth/Storage. No se conectó a Supabase remoto. Los resultados no acreditan integración con Supabase Auth real ni con Vercel. Las capturas están en `artifacts/auditoria-v7/evidencias/`.

## Hallazgos confirmados

### V7-A01 — P1: el segundo mensaje del comprador se envía al identificador equivocado

- **Ubicación:** `static/js/chat-cuentas.js:409` (y su copia CDN), frente al envío en la línea 403 y la inicialización correcta en la 284.
- **Causa:** tras un envío exitoso se asigna `currentVehicle = {...result.conversacion}`. El campo `id` de esa respuesta identifica la conversación; el vehículo está en `vehiculo_id`.
- **Reproducción:** abrir Toyota Corolla desde Mis conversaciones; enviar un mensaje; sin cerrar el hilo enviar otro. En 1440 y 390 px, el primer POST a `/api/cuenta/chat/comprador/vehiculos/7/mensajes` devolvió 201. El siguiente usó un UUID en el segmento del vehículo y devolvió 404. También afecta el hilo recién iniciado porque ejecuta la misma asignación tras el primer envío.
- **Impacto:** no se puede mantener una conversación normal sin salir y volver a abrirla. El backend no pierde la autorización: rechaza la URL inválida.
- **Evidencia:** `recorridos.mjs`, caso «segundo envio usa UUID conversacion como vehiculo», dos resoluciones, `resultados.json`.
- **Corrección propuesta:** construir explícitamente el estado de vehículo con `id: result.conversacion.vehiculo_id`, dejando separados ambos identificadores. Regresión de dos o más envíos seguidos tanto en conversación nueva como recuperada.

### V7-A02 — P1: el registro de cuentas escribe en Preview de solo lectura

- **Ubicación:** `cuentas.py:48`, `cuentas.py:98`, `cuentas.py:112`; comparado con `app.py:55` y los bloqueos de escritura de vehículos/chat.
- **Condiciones:** `VERCEL_ENV=preview`, `USER_AUTH_ENABLED=true` y CSRF válido. No requiere saltarse autenticación ni conocer secretos. USER_AUTH_ENABLED está deshabilitado por defecto.
- **Reproducción:** la prueba nueva configura `APP_READ_ONLY=true` y Preview, realiza registro con Auth falso y comprueba respuesta 200, rol creado y sesión local persistida. El blueprint no consulta APP_READ_ONLY antes de registrar/iniciar sesión.
- **Impacto:** contradice la garantía global de Preview de consulta. Si se habilita V7 en una Preview enlazada accidentalmente a Production, el registro puede crear identidades/roles/sesiones en esos servicios. No se intentó ni se confirmó esa configuración remota. Los endpoints de vehículos y envío de chat sí conservan su bloqueo de escritura.
- **Evidencia:** `tests/auditoria_v7_reproducciones.py`, `test_reproduce_registro_escribe_en_preview_solo_lectura`.
- **Corrección propuesta:** definir una política explícita para escrituras de cuentas y aplicarla antes de llamar al proveedor o guardar sesiones. Mantener Preview sin escrituras bajo la política vigente; un ambiente funcional de V7 debe usar Auth y PostgreSQL aislados y una habilitación explícita. Permitir cierre/revocación de sesiones no equivale a autorizar registros. Añadir prueba que exija rechazo y cero invocaciones de escritura.

### V7-A03 — P2: reabrir Mis conversaciones elimina borradores del comprador

- **Ubicación:** `static/js/chat-cuentas.js:345` llama a `clearPrivateState()`; esta función hace `drafts.clear()` en la línea 102. `closeDialog()` había guardado el texto.
- **Reproducción:** escribir un borrador en una conversación, cerrar con X, abrir Mis conversaciones y seleccionar el mismo hilo. El textarea vuelve vacío en 1440 y 390 px, sin cambiar de cuenta.
- **Impacto:** pérdida de trabajo aunque el usuario no haya cerrado sesión. La navegación a la ficha también recrea el script y pierde el mapa en memoria; este segundo alcance se deduce del código y no se presenta como recorrido adicional ejecutado.
- **Evidencia:** caso «borrador perdido tras cerrar y reabrir» del guion Playwright.
- **Corrección propuesta:** separar reinicio visual de limpieza por cambio/fin de sesión. Preservar borradores por conversación e identidad mientras la cuenta siga siendo la misma, y eliminarlos al cerrar sesión o cambiar de usuario. Decidir por separado si se requiere persistencia segura entre páginas.

### V7-A04 — P2: cambiar de hilo rompe la idempotencia de un envío incierto del vendedor

- **Ubicación:** `static/js/vendedor-chat-cuentas.js:189`, `:217`, `:291`. Patrón similar en comprador `chat-cuentas.js:286`; su reproducción específica queda pendiente.
- **Reproducción controlada:** interceptar un POST del vendedor; enviarlo realmente al Flask local mediante `route.fetch()` y comprobar 201, pero abortar la respuesta al navegador. Cambiar a otra conversación, volver y reenviar el borrador conservado. El segundo POST usa una nueva Idempotency-Key y devuelve 201. Se observan **dos mensajes iguales con IDs distintos** en el hilo.
- **Impacto:** una operación que el usuario entiende como reintento crea duplicados. El backend es idempotente cuando recibe la misma clave; el frontend la descarta al navegar.
- **Evidencia:** caso «respuesta confirmada pero perdida se duplica tras cambiar hilo», `vendedor-reintento.png`. El script comprueba dos claves diferentes y dos artículos de mensaje con igual contenido.
- **Corrección propuesta:** conservar `{clave, contenido, conversación}` por envío incierto y cuenta hasta reconciliar o confirmar el resultado. No regenerar la clave al restaurar un borrador de ese envío. Aplicar la misma revisión al comprador sin eliminar la protección de cambio de cuenta.

### V7-A05 — P2: datos privados ya descargados permanecen visibles tras cambiar de cuenta en otra pestaña

- **Ubicación:** `static/js/chat-cuentas.js:122`, `:273` y `:345`. La identidad se verifica al abrir, pero un polling 404 solo modifica el texto de error.
- **Reproducción:** A abre su hilo; sustituir las cookies locales por las de B (simula el efecto de iniciar otra cuenta en otra pestaña del mismo navegador). `/api/cuenta` confirma una identidad válida de B. El siguiente polling al hilo de A devuelve 404, pero el DOM conserva los mensajes de A y el formulario. Reproducido en 1440 y 390 px.
- **Impacto:** incumplimiento de privacidad de la interfaz en navegador compartido/cambio de cuenta; **no es una lectura IDOR de la API**. B no obtuvo mensajes nuevos de A del servidor: los visibles eran los ya descargados por A. El caso de logout sin relogin recibe 401 y tiene una ruta de limpieza; no se confunden ambos escenarios.
- **Evidencia:** «cuenta B activa conserva DOM privado de A tras polling 404», capturas `comprador-1440.png` y `comprador-390.png`.
- **Corrección propuesta:** invalidar generaciones y solicitudes pendientes, borrar DOM privado y confirmar la identidad al detectar pérdida de acceso, volver al primer plano o recibir una señal de cambio de sesión entre pestañas. La señal no debe contener credenciales ni mensajes. No sustituir la autorización del servidor por esa señal.

## Autenticación y autorización revisadas

- Flask obtiene identidad desde el endpoint Auth `/user`, coteja UUID con la sesión opaca local y consulta el rol en PostgreSQL. No decodifica un JWT sin verificar ni usa el rol del navegador como autorización posterior al alta.
- La elección inicial comprador/vendedor es una capacidad deliberada de registro. El trigger valida ese conjunto, lo copia una vez y prohíbe modificarlo después. La prueba PostgreSQL verifica que editar `raw_user_meta_data` no cambie el rol; la prueba nueva modifica metadatos del doble y mantiene rol comprador.
- Logout borra el hash de la sesión local antes de pedir revocación remota. La nueva prueba copia y restaura las tres cookies después de logout: sigue obteniendo 401. No se demostró reactivación de una sesión local revocada.
- Cookies de cuenta: HttpOnly, SameSite=Lax, Secure con Vercel/HTTPS y duración máxima local de siete días. El access token conserva además su expiración de Auth. Se exige CSRF en POST de cuentas y escrituras privadas. No se guardan contraseñas ni mensajes operativos en localStorage. Errores del proveedor se transforman en mensajes genéricos; no se inspeccionaron archivos de credenciales.
- Las sesiones simultáneas locales son independientes. Un nuevo login no revoca todos los SID anteriores; esto no se clasificó como vulnerabilidad porque se admiten sesiones simultáneas. Logout invalida la sesión indicada, no promete un cierre global en todos los dispositivos.
- Un registro sin tokens devuelve 202 y pide revisar el correo. El proveedor y el trigger deben ser atómicos en Supabase; fallos después de crear Auth pero antes de guardar sesión requieren reintentar login. Solo se comprobó el comportamiento de dobles, no confirmación de correo/alta duplicada reales.
- Renovación por refresh, expiración local y UUID de Auth discordante fueron probados con dobles. Quedan pendientes rotación concurrente de refresh y fallos reales de Auth. `identidad()` intenta renovar ante cualquier ErrorAuth de `/user`, incluso 503: revisar el coste y la recuperación, sin afirmar una pérdida de sesión demostrada.

## Propiedad, fotografías y concurrencia

Las consultas de edición, disponibilidad y retiro añaden vendedor_id desde ContextVar; las escrituras V6 se limitan a vendedor_id IS NULL. El cliente no puede inyectar vendedor_id en el formulario. Las reservas y confirmaciones de fotos bloquean la fila activa y su propietario antes de operar. Las fotos públicas conservan su acceso público intencional.

Las pruebas reales con dos vendedores y un comprador rechazaron lectura privada, edición, disponibilidad, retiro y alta/sustitución/eliminación de fotos ajenas; rechazaron claves idempotentes ajenas y operación V6 sobre vehículos V7. La nueva prueba verificó que ContextVar vuelve a None/False tras respuesta normal y error 503. La prueba existente de concurrencia comprueba que editar y retirar no resuciten la fila.

Chat: SQL limita lecturas y respuestas a participantes y propietario; claves idempotentes verifican autor, vehículo/conversación y huella. Los bloqueos rol/vehículo/conversación serializan cuota, creación, respuesta y retiro. Pasaron las pruebas con conexiones independientes de creación/reintento concurrente, respuesta concurrente y retiro frente a conversación nueva. Las restricciones públicas permanecen cerradas. Estas garantías no corrigen el descarte de claves del frontend descrito en A04.

## Migraciones y orden de despliegue

Orden obligatorio: V6.5.4 → `20261112002005_v71_roles_usuarios.sql` → `20261112004250_v72_propiedad_vehiculos.sql` → `20261112010722_v73_chat_cuentas.sql` → código V7 → habilitación deliberada posterior a validación. **Desactivar USER_AUTH_ENABLED no hace al código V7 compatible con una base que carece de vendedor_id**: el catálogo común ya selecciona esa columna.

La fixture aplicó todas las migraciones en orden sobre bases desechables; V7 se aplicó después de las filas semilla y del retiro V6.5.4. Esto verifica conservación del conjunto local, no una restauración de los 17 vehículos remotos.

| Elemento | Resultado local y límite |
| --- | --- |
| Roles/sesiones | FK privada, rol cerrado e inmutable, RLS y REVOKE a PUBLIC/anon/authenticated. |
| Trigger auth.users | Se instaló sobre tabla Auth mínima local y se verificó alta/rollback atómico. No equivale al esquema ni al rol supabase_auth_admin real. |
| SECURITY DEFINER V7.1 | search_path vacío, tablas calificadas y EXECUTE público revocado. Verificar propietario/grants del ejecutor real en ensayo Supabase. |
| Propiedad | Columna nullable preserva publicaciones heredadas. Trigger restringe dueño a vendedor y evita transferir publicaciones asignadas. No hay asignación automática de heredados. |
| Conversaciones | FK RESTRICT conserva participantes/vehículos; mensajes tienen FK a conversación e identidad, triggers de participantes, índices por hilo/cursor. Retiro conserva historial, bloquea mensajes nuevos desde repositorio. |
| Privilegios | Tablas/seq V7 sin grants públicos, RLS habilitado. Conexión de Flask es de confianza y debe tener privilegios explícitos; no se comprobó su rol remoto. |
| Aplicación repetida | V7.2/V7.3 contienen DDL sin IF NOT EXISTS: aplicar una vez mediante historial. No se deben repetir manualmente. |
| Borrado de Auth | FK CASCADE de roles combinado con vehículos/conversaciones RESTRICT puede impedir borrar cuentas con historial. Se necesita política futura de baja; no hay borrado de cuentas en esta entrega. |

Antes de migrar: respaldo restaurable, ensayo sobre copia aislada, comprobar usuarios Auth preexistentes (el trigger no les crea rol retroactivamente), propietario de funciones, capacidad de supabase_auth_admin para ejecutar el alta y privilegios de Flask. No otorgar permisos a anon/authenticated para resolver esos problemas. No aplicar V7 en Production para completar esta auditoría.

## Pruebas ejecutadas y alcance de cobertura

| Prueba | Resultado |
| --- | --- |
| test_cuentas.py | 9 aprobadas, Auth doble |
| test_cuentas_postgres.py | 1 aprobada, PostgreSQL real + auth.users mínima |
| test_vendedor_postgres.py | 2 aprobadas, PostgreSQL real + Auth/Storage dobles |
| test_chat_cuentas_persistencia.py | 11 aprobadas, incluidas concurrencia, RLS y aislamiento |
| test_chat_cuentas_api.py | 6 aprobadas, HTTP con dobles |
| test_chat_cuentas_http_postgres.py | 1 aprobada, HTTP + PostgreSQL real + Auth doble |
| test_chat_api.py | 14 aprobadas de chat anónimo V6 |
| test_static_assets.py | 5 aprobadas; recursos rastreados/MIME/copias CDN |
| auditoria_v7_reproducciones.py (nueva) | 4 comprobaciones: un defecto confirmado y tres controles positivos |
| Node: test_chat_cuentas_ui.mjs, test_chat_ui.mjs, test_chat_sidebar_behavior.mjs | 21 aprobadas; la mayoría cubre V6 y no demuestra el comportamiento V7 |
| Playwright nuevo | 7 observaciones diagnósticas confirmadas: 3 en ambas resoluciones + reintento vendedor |

Total final Python: **53 comprobaciones** (49 existentes + 4 diagnósticas nuevas), sin omitidas en los archivos seleccionados. No se ejecutó toda la batería ajena al riesgo. Las comprobaciones diagnósticas que pasan **confirman que el defecto existe**, no que esté solucionado. Los tests previos enviaban un mensaje por apertura; no ejercitaban el segundo envío ni la respuesta perdida seguida de navegación. Por eso su aprobación no detectó estos defectos.

La navegación Playwright usa cuentas/vehículos ficticios con PostgreSQL local; el cambio de cuenta se reproduce cambiando cookies del contexto, no ejecutando login contra Supabase. Registro/login/logout se ejercitan mediante pruebas HTTP con dobles. Quedan pendientes los recorridos visuales completos de registro y publicación de vehículo, y un proveedor Auth real. No se presenta ese alcance como aprobado en navegador.

Reproducción desde la raíz (PowerShell; rutas de herramientas disponibles en este equipo):

```powershell
$env:PYTHON_DOTENV_DISABLED='1'
$env:FLASK_SECRET_KEY='audit-v7-local'
$env:TEST_DATABASE_URL='host=127.0.0.1 port=55479 dbname=grupo7_test_v654 user=v654test'
# Arrancar únicamente el clúster de pruebas loopback, si está detenido.
& "$env:TEMP\v654-pg17\pgsql\bin\pg_ctl.exe" -D "$env:TEMP\v654-pg17-data" -o '-p 55479 -h 127.0.0.1' -l "$env:TEMP\audit-v7-pg.log" start
try {
  & "$env:TEMP\v732-test-venv\Scripts\python.exe" -m unittest discover -s tests -p auditoria_v7_reproducciones.py -v
  node artifacts/auditoria-v7/recorridos.mjs "$env:TEMP\v732-test-venv\Scripts\python.exe" artifacts/auditoria-v7/fixture_servidor.py "$env:TEMP\v733-playwright\node_modules\playwright\index.mjs" "$env:LOCALAPPDATA\ms-playwright\chromium-1254\chrome-win64\chrome.exe" artifacts/auditoria-v7/evidencias
} finally {
  & "$env:TEMP\v654-pg17\pgsql\bin\pg_ctl.exe" -D "$env:TEMP\v654-pg17-data" stop -m fast
}
```

Los valores del comando son exclusivos del entorno ficticio loopback. La fixture exige host local/base grupo7_test*, crea otra base UUID y la elimina al terminar. El script no imprime el DSN ni las cookies. Servidor temporal y clúster fueron detenidos. `git diff --check` pasó y static/public/static coinciden byte por byte. Solo `.env.example` está rastreado entre los archivos de entorno; no se abrió `.env`.

## Supabase real: riesgos y comprobaciones pendientes

- No existe un proyecto de pruebas Supabase. No se acreditan REST de Auth, rotación real de tokens, confirmación/alta duplicada, recuperación ante proveedor caído, cuotas reales ni ejecución del trigger bajo roles de plataforma. Los tests locales usan privilegios del clúster de pruebas.
- La [documentación oficial de cierre de sesión](https://supabase.com/docs/guides/auth/signout) confirma que revocar refresh tokens no invalida retroactivamente JWT de acceso. La sesión opaca local sí se comprueba en cada petición y su revocación se probó; una revocación efectuada solamente fuera de Flask requiere evaluar la ventana hasta exp y, si se exige invalidación inmediata, comprobar sesión remota. No se declara ese riesgo como explotación demostrada.
- La [guía de datos de usuarios](https://supabase.com/docs/guides/auth/managing-user-data) describe triggers de alta y advierte que errores del trigger pueden bloquear registros. El código de V7.1 rechaza identidades sin v71_rol: verificar que los flujos reales permitidos siempre lo envíen y definir tratamiento de identidades previas. No usar metadatos editables para autorización posterior.
- Revisados [changelog](https://supabase.com/changelog.md) y [sesiones](https://supabase.com/docs/guides/auth/sessions). No se cambió SDK, CLI ni configuración remota.
- Falta verificar límites reales de Auth frente a fuerza bruta y comportamiento detrás del proxy. El limitador V6 no protege automáticamente las rutas V7; no se afirma que el proveedor carezca de límites.
- Production rechaza V7 por VERCEL_ENV=production, además de USER_AUTH_ENABLED=false por defecto; las pruebas comprobaron la guarda. Habilitar V7 requerirá cambiar deliberadamente esa política en una tarea posterior. No basta editar una variable. A02 debe resolverse antes de usar Preview con Auth.

## Correcciones necesarias y decisión

Resolver A01 y A02 antes de cualquier integración destinada a producción. Corregir A03–A05 antes de presentar V7 como mensajería fiable y privada entre cuentas. Mantener separados identidad, vehículo, conversación y solicitud idempotente en el frontend. Extender regresiones a los recorridos multienvío, cambio de cuenta y resultados de red inciertos; no sustituirlas por búsqueda de cadenas en el código.

Tras las correcciones, repetir solo las reproducciones y suites afectadas, ensayar las migraciones y Auth en un entorno Supabase aislado autorizado, y completar los recorridos visuales pendientes. Revisar los PR en orden V7.1 → V7.2 → V7.3, conservando las bases encadenadas. Los cinco defectos permanecen sin corregir deliberadamente: esta entrega es diagnóstica.

## Cierre de correcciones — 12 de noviembre de 2026

La sección anterior describe el estado histórico auditado. Los cinco hallazgos se corrigieron posteriormente en la misma rama, sin cambiar persistencia, contratos API, esquemas ni migraciones. La evidencia original bajo `artifacts/auditoria-v7/` y el diagnóstico original `tests/auditoria_v7_reproducciones.py` permanecen intactos localmente: **sus aserciones de existencia del defecto no son pruebas de aceptación del arreglo**. No se ejecutaron como si fueran regresiones verdes.

| Hallazgo | Corrección | Regresión de aceptación | Resultado / estado |
| --- | --- | --- | --- |
| A01 | chat-cuentas.js conserva currentVehicle.id desde vehiculo_id, independiente del ID del hilo. | Tres mensajes en hilo recuperado y dos en hilo nuevo, sin cerrar. | PASS a 1440/390; corregido. |
| A02 | cuentas.py rechaza registro/login antes del proveedor y de PostgreSQL en modo consulta o Preview. No renueva tokens en consulta; permite revocar/logout. Production continúa bloqueada. | test_cuentas.py: rechazo 503 y spies sin llamadas a registrar/login/guardar_sesion; sin roles/sesiones nuevas; logout permitido; refresh no invocado. | PASS; corregido. La nueva prueba falló antes del arreglo. |
| A03 | Borradores en memoria por vehículo/hilo; cierre y navegación no borran los mapas. La invalidación de identidad sí los borra. | Dos borradores distintos, volver a cada hilo, cerrar y reabrir; logout limpia textarea. | PASS a 1440/390; corregido. No se usa localStorage. |
| A04 | Mapas por contexto conservan clave/contenido de cada operación incierta de comprador y vendedor. Confirmación limpia solo su operación. Un texto nuevo no se envía ni pierde al reconciliar el anterior. | route.fetch confirma 201 y se aborta la respuesta; cambiar de hilo y reintentar devuelve 200 con la misma clave y un solo mensaje. Siguiente envío deliberado usa nueva clave y devuelve 201. | PASS para ambos roles a 1440/390; corregido. |
| A05 | CuentaSesion transmite solo invalidación entre pestañas. Comprador/vendedor limpian nodos, textos y mapas, abortan peticiones y cambian generación de identidad. Verifican /api/cuenta antes de operar y al recuperar foco; pérdidas de acceso al hilo invalidan datos. | Login/logout reales en UI contra Auth doble; cambio entre pestañas, respuesta vieja retenida/liberada y cambio sin señal detectado antes del polling. DOM y borradores anteriores vacíos. | PASS a 1440/390; corregido. La autorización del backend sigue siendo obligatoria. |

`static/js/cuenta-sesion.js` usa BroadcastChannel con el único payload `changed`. No transmite credenciales, identidad ni contenido. Si el navegador no dispone de BroadcastChannel, la comprobación de identidad al operar/recuperar foco permanece activa. Los mapas son exclusivos de la página y la cuenta actual: no prometen persistencia después de recargar/navegar a otra página. Una respuesta de envío confirmada después de cambiar de vista puede liquidar su solicitud sin reinsertar mensajes en una vista distinta.

Pruebas finales seleccionadas para estas correcciones:

- Python: **26 aprobadas**, sin omitidas: cuentas (12), API chat de cuentas (6), HTTP con PostgreSQL real (1), propiedad vendedor (2), recursos estáticos (5).
- Node: **21 aprobadas** de compatibilidad de chat/UI V6 y V7; no se confunden con la prueba de navegador nueva.
- `tests/playwright/chat_cuentas_regression.mjs`: **14 grupos de comprobaciones aprobados**, siete por resolución, con Flask/PostgreSQL 17 reales y Auth doble. `tests/fixture_chat_cuentas_ui.py` crea una base nueva por ejecución/resolución: no se aumenta ni desactiva la cuota real de mensajes para las pruebas. El fixture siembra exclusivamente datos ficticios.
- Los fallos intermedios del nuevo guion fueron de preparación/selección de datos (segunda conversación faltante, serialización de UUID, dos consultas del mismo vehículo) y cuota al reutilizar datos entre resoluciones. Se ajustó el fixture/guion y se ejecutaron ambas resoluciones hasta PASS; las cuotas de aplicación permanecen intactas.
- Capturas nuevas inspeccionadas en `artifacts/v7-correcciones/1440/` y `artifacts/v7-correcciones/390/`, cada carpeta con resultados.json. No se versionaron capturas/logs ni se sobreescribieron las evidencias originales.
- `scripts/preparar_vercel.py` sincronizó las 20 copias estáticas; test_static_assets verifica MIME, empaquetado, rastreo y coincidencia byte por byte. Sintaxis Node y diff --check aprobados.

Para repetir la regresión nueva, reutilizar el entorno loopback del comando histórico, arrancar el clúster de pruebas y ejecutar **una invocación por resolución** (cada proceso crea/elimina su propia base):

```powershell
foreach ($ancho in @(1440,390)) {
  node tests/playwright/chat_cuentas_regression.mjs "$env:TEMP\v732-test-venv\Scripts\python.exe" "$env:TEMP\v733-playwright\node_modules\playwright\index.mjs" "$env:LOCALAPPDATA\ms-playwright\chromium-1254\chrome-win64\chrome.exe" "artifacts/v7-correcciones/$ancho" $ancho
  if ($LASTEXITCODE -ne 0) { throw 'Falló la regresión de navegador' }
}
```

**Estado actual:** cinco hallazgos cerrados en el entorno aislado; ninguna migración remota ni cambio en Production. Continúan pendientes la integración con Supabase Auth real, privilegios/trigger bajo los roles reales de plataforma y el ensayo autorizado de despliegue descritos en esta auditoría. V7 **no se declara lista para Production**. Las correcciones se publican únicamente para revisión del PR #22.
