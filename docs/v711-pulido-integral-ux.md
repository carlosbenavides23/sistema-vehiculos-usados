# V7.11 — Correcciones de vendedor y conversaciones

Base: `65ba05c` (V7.10), rama `fix/v711-pulido-integral-ux`. Este documento complementa la auditoría local `auditoria-ux-v710.md` y conserva sus evidencias originales. No se incorporan sus archivos preexistentes al commit de implementación.

## Correcciones y verificación

| Hallazgo | Corrección implementada | Archivos principales | Regresión y resultado |
|---|---|---|---|
| UX710-01 | Polling HTTP de bandeja visible; reconciliación por ID sin sustituir botones; refresco de todas las páginas ya expandidas; revisión local para invalidar respuestas anteriores a un envío | `static/js/vendedor-chat-cuentas.js` | Playwright: nueva consulta desde otro comprador, foco sobre el mismo nodo, respuesta retenida tras envío, borrador y selección conservados, ventana paginada de 100→101 filas, suspensión con panel oculto. Aprobado |
| UX710-02 | Historial con scroll propio, altura calculada con viewport disponible y visualViewport; encabezado y compositor estables. Al entrar se muestran mensajes recientes; el polling respeta la lectura de mensajes antiguos | `static/css/admin-v6.css`, `static/js/vendedor-chat-cuentas.js` | Playwright: historial de 26+ mensajes, editor dentro del viewport, recibir mensaje sin desplazar la lectura; comprobación adicional de viewport reducido a 390×320. Aprobado |
| UX710-03 | Confirmación nativa antes de «Ver ficha» si hay texto; cancelar conserva borrador, confirmar autoriza descartarlo | `static/js/chat-cuentas.js` | Playwright: cancelar, confirmar, salir sin texto y después de un envío confirmado. Aprobado. No se añade almacenamiento privado persistente |
| UX710-04 | Sincronización explícita de `aria-selected` al abrir, volver a lista y refrescar | `static/js/vendedor-chat-cuentas.js` | Playwright: exactamente una opción seleccionada y ninguna al volver a lista móvil; polling no altera selección ni foco. Aprobado |
| UX710-05 | Dos columnas de fotos en móvil, pies adaptativos con acciones completas, tipografía de 12 px y controles de al menos 44 px | `static/css/admin-v6.css` | Playwright: galerías de 5 a 1 fotos, sin clipping/overflow, eliminar con confirmación, sustituir con previsualización y guardado real local. Aprobado |
| UX710-06 | Acciones de filas deshabilitadas sincrónicamente al cargar, guardas en callbacks y generaciones; recuperación del foco incluso con recargas superpuestas | `static/js/admin-v6.js` | Playwright: respuesta retenida, botones bloqueados, segunda respuesta vigente, descarte de datos obsoletos, foco restaurado y conflicto 409 conservado. PostgreSQL: cambio condicional atómico y rechazo de reversión obsoleta. Aprobado |
| UX710-07 | Fecha de creación, último mensaje, extracto de hasta 160 caracteres y referencia corta del hilo, obtenidos solo en consulta autorizada | `archivo_chat.py`, `templates/archivo_chat.html`, `static/css/archivo-chat.css` | PostgreSQL/HTTP: contenido escapado, sin visitante ni secretos, otro vendedor sin acceso, historial intacto y sin escrituras. Playwright: cuatro historiales del mismo vehículo distinguibles. Aprobado |
| UX710-08 | Encabezado de tabla «Estado» | `templates/admin_v6.html` | Playwright: etiqueta correcta, sin overflow a 768/1024/1440; inventario móvil conservado. Aprobado |
| UX710-09 | Confirmaciones informativas se retiran al cambiar de vista; errores globales permanecen | `static/js/admin-v6.js` | Playwright: guardar→Conversaciones sin «Cambios guardados»; error de cierre de sesión simulado permanece al navegar. Aprobado |
| UX710-10 | Nota de placa «No se muestra en el catálogo.» | `templates/admin_v6.html` | Playwright comprueba texto y ausencia de placa en GET público; regresiones de propietario y API. Aprobado |

Todas las copias modificadas de `static/` se sincronizan mediante `scripts/preparar_vercel.py` en `public/static/`.

## Decisiones técnicas

- Se conserva el API, la paginación por cursor y el intervalo HTTP de cuatro segundos. El refresco vuelve a recorrer hasta cubrir los IDs previamente cargados, incluyendo los desplazados a otra página por actividad reciente. No convierte «Pendiente» en un estado de lectura. No se eliminan borradores ni se reconstruyen botones en cada tick.
- La reconciliación actualiza contenido solo cuando cambia la fila y conserva el nodo enfocado y el scroll de la lista. Una revisión de envíos locales evita que una respuesta de bandeja anterior sobrescriba su metadata reciente. Las comprobaciones de identidad existentes siguen invalidando solicitudes y limpiando datos privados.
- La altura del chat depende de su posición y del viewport, no de un alto fijo de 600 px. Si el espacio se reduce mientras el editor tiene foco, se conserva el área de controles y se desplaza el documento para mantenerlo visible. El historial solo sigue el final al abrir o si el usuario ya estaba cerca del final; un envío propio se lleva al final.
- Para borradores al navegar se utiliza la advertencia aprobada. No se guardan conversaciones en localStorage ni se cambia el modelo de sesiones.
- El archivo usa subconsultas parametrizadas por conversación y mantiene el filtro de propietario. Selecciona fechas y extracto, no identidades de visitantes ni verificadores. Jinja escapa el texto; la referencia corta deriva del ID del hilo ya usado en su ruta y no concede autorización.
- Se reutilizan colores, tipografía, iconos y controles V6. Se consultaron las skills locales `ui-ux-pro-max`, `design-system` y `ui-styling`, especialmente feedback, foco, composición y estados accesibles. No se incorporó su stack React/Tailwind/shadcn ni dependencias nuevas.

## Pruebas localizadas

- **33 Python aprobadas**, sin omisiones en las suites seleccionadas: cuenta, API de chat privado, retiro de administración/archivo (incluye nueva regresión de metadata), disponibilidad condicional real, recursos estáticos y autorización del vendedor.
- **15 Node aprobadas**: errores progresivos del formulario, preservación de valores históricos, integración del panel y selector/polling de conversaciones. Se adaptó una comprobación estática existente a la nueva guarda de visibilidad; el comportamiento se verifica también en navegador.
- **Playwright:** diez casos UX en cada ancho 390, 768, 1024 y 1440 × 900; más reemplazo de fotografías, viewport reducido y regresiones preexistentes de chat a 390/1440. Se verificaron reintentos idempotentes de comprador/vendedor, borradores, aislamiento y cambio de cuenta entre pestañas. Sin errores JavaScript en los recorridos aprobados.
- Antes de la corrección, nueve casos automatizados fallaron contra el commit base en un checkout temporal; para UX710-06 se conserva la reproducción original de la auditoría y se agregó la prueba funcional con respuestas retenidas. El guion de diagnóstico no se presenta como prueba de corrección: las mismas expectativas pasan contra V7.11.
- Los errores iniciales del guion (cuotas consumidas por datos sembrados con fecha actual, navegación a una lista móvil aún oculta y mayúsculas visuales del encabezado) se corrigieron en las fixtures/aserciones. No se alteraron cuotas ni lógica productiva para hacer pasar pruebas.
- `node --check`, compilación Python, `git diff --check` y comparación byte a byte de las dos carpetas estáticas.

Comandos Python:

```powershell
$env:PYTHONPATH='tests'
# TEST_DATABASE_URL debe indicar únicamente PostgreSQL loopback grupo7_test*.
$env:PYTHON_DOTENV_DISABLED='1'
.\.venv\Scripts\python.exe -m unittest test_retiro_admin test_chat_cuentas_api test_cuentas test_postgres_integracion.PostgresIntegracionTest.test_disponibilidad_condicional_es_atomica_y_no_revierte_version_obsoleta
.\.venv\Scripts\python.exe -m unittest test_static_assets test_vendedor_postgres
node --test tests/test_chat_cuentas_ui.mjs tests/test_admin_form_errors.mjs tests/test_admin_v6_field_values.mjs tests/test_v6_admin_ui.mjs
```

Playwright, reutilizando las herramientas de desarrollo existentes:

```text
node tests/playwright/v711_ux.mjs <python> <playwright/index.mjs> <chromium.exe> <evidencias> <390|768|1024|1440>
```

`V711_TESTS` admite IDs separados por coma para repetir únicamente casos afectados. `V711_REPO_ROOT` permite comprobar otro checkout local. La fixture rechaza bases remotas mediante `base_aislada()`, crea una base UUID y aplica migraciones solo allí; Auth y Storage son dobles locales. Las escrituras de vehículos/fotos/mensajes se limitan a esa base y memoria desechables. Cada ejecución crea su propio conjunto para respetar cuotas reales.

## Evidencias de revisión

Capturas y JSON fuera del commit en `artifacts/v711/`: `before-390`, `verified-{390,768,1024,1440}`, `supplement-{390,768}`, `focus-390`, `layout-{390,768,1024,1440}` y `chat-existing-{390,1440}`. Las verificaciones complementarias corresponden únicamente a ajustes posteriores o ampliaciones localizadas de cobertura. Las capturas de galería comprueban controles completos dentro de su tarjeta y objetivos ≥44×44 px; los colores conservan los pares V6 de texto/fondo, sin nuevos colores de estado.

Los scripts de prueba son versionados; las capturas, logs y datos generados permanecen locales. La auditoría original no se reescribe y los cambios preexistentes de `AGENTS.md`, `artifacts/` y otros informes quedan fuera de estos commits.

Contraste de los pares de color conservados en componentes modificados: botones de fotografías `#35574f` sobre blanco **7,99:1**; metadata de archivo `#5d7073` sobre blanco **5,21:1**; texto principal `#1b3036` sobre blanco **13,79:1**; verde sobre fondo seleccionado `#eaf1ed` **6,97:1**. Se revisaron las capturas de escritorio y móvil, no solo los selectores. Estas muestras no equivalen a certificar toda la aplicación.

## Límites y despliegue

No hay migraciones nuevas ni cambios en autenticación, UUID, roles, propiedad, RLS, sesiones, CSRF, idempotencia, retiro o Storage. No se ejecutó ninguna operación remota ni se habilitó Auth en Preview. No hay cambios de configuración necesarios para estas correcciones.

Pendientes de revisión manual: lector de pantalla real, Safari/Firefox y teclado virtual en dispositivo físico. El viewport reducido de Chromium verifica geometría, no sustituye un teclado móvil real ni certifica WCAG completo. La integración con Supabase Auth/Storage reales no se evaluó en esta tarea y Production no se modificó.
