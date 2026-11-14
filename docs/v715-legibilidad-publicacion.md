# V7.15 — Legibilidad y registro intuitivo de vehículos

Base: `38143f3` (V7.14). Alcance: pulido de componentes existentes, sin cambios de negocio, autenticación, persistencia ni esquema.

## Fricciones identificadas

- En escritorio había ayudas, metadatos y mensajes de 10–13 px en el panel, la cuenta y las conversaciones; algunos datos del catálogo y de la ficha también tenían menor jerarquía de la necesaria.
- «Características técnicas» invitaba a dejar campos vacíos pero contenía kilometraje obligatorio. Los datos principales mezclaban campos requeridos con el tipo opcional.
- Al terminar un formulario largo, el botón de guardar de escritorio quedaba arriba. El resultado del guardado explicaba las fotografías, pero faltaba un acceso directo a la ficha propia desde la edición.
- La fotografía seleccionada tenía vista previa y confirmación independientes; convenía distinguir explícitamente lo pendiente de lo ya guardado.

## Cambios y decisiones

- `static/css/legibilidad-v715.css`: escala localizada de lectura para escritorio desde 1200 px, comprobada a **1920 × 1080**. Texto de lectura/controles alrededor de 16 px, etiquetas/acciones de 15 px y ayudas/metadatos de 14 px; se mantienen títulos, composición, colores, iconos y jerarquía. Los encabezados de tabla conservan 13 px. No se aumenta el tamaño de todo el documento ni se añade una biblioteca.
- `templates/index.html`, `templates/cuenta.html`, `templates/admin_v6.html`: cargan esa hoja después de sus estilos existentes. Las copias CDN se generan con el mecanismo habitual.
- El registro continúa en una sola pantalla. Marca, modelo, año, kilometraje, precio y ubicación quedan juntos; descripción sigue siendo obligatoria en su sección. Tipo y características opcionales se agrupan aparte. Se conservan nombres, IDs, atributos de validación y payloads.
- Se explica la secuencia **datos → guardar vehículo → añadir y guardar fotografías**. El botón inferior existente también se muestra en escritorio; ambos botones envían el mismo formulario y comparten su bloqueo durante el guardado.
- Tras confirmar el guardado aparecen «Añadir fotografías», «Ver ficha pública» y «Volver al inventario». La ficha utiliza el ID devuelto por la API y el retorno existente `?desde=inventario`, autorizado por Flask. El acceso a fotografías solo desplaza y enfoca su encabezado: no repuebla el formulario ni borra cambios pendientes.
- La selección se identifica como **«Vista previa sin guardar»**; las imágenes confirmadas muestran **«Foto N · Guardada»**. No se alteran compresión, reservas, Storage, confirmación, sustitución ni borrado. La advertencia existente ante salida con cambios o fotografías pendientes permanece activa.
- `static/js/admin-v6.js` solo mantiene esos accesos y textos. No se cambian filtros, sesiones, duración de cookies, CSRF, propiedad, disponibilidad ni lógica de conversaciones.
- `public/static/css/legibilidad-v715.css` y `public/static/js/admin-v6.js` son copias generadas, no implementaciones separadas.

## Verificación localizada

- **16 pruebas Node aprobadas**: `test_admin_form_errors.mjs`, `test_admin_v6_field_values.mjs`, `test_v6_admin_ui.mjs`, `test_v6_public_ui.mjs`. Cubren errores progresivos, valores históricos, estructura del formulario, contratos de guardado/fotos, filtros y ficha.
- **4 pruebas Python aprobadas**: MIME de recursos estáticos, empaquetado de recursos públicos, archivos CDN rastreados e idénticos y validación de campos opcionales nulos (`test_static_assets` y `test_vehiculos`, casos seleccionados).
- `tests/playwright/v715_publicacion.mjs`: recorrido real Chromium/Flask a **1920 × 1080**, reutilizando `fixture_v711_ui.py`. PostgreSQL 17 local crea y elimina una base UUID aislada; Auth y Storage son dobles. Se bloquean peticiones fuera del origen loopback. Las imágenes son WebP ficticias válidas.
- El recorrido comprueba vendedor sin publicaciones, siete errores requeridos asociados por `aria-describedby`, corrección progresiva, alta con opcionales nulos, acciones posteriores, conservación de un cambio al enfocar fotografías, vista previa antes de guardar, fotografía persistida y visible en ficha/inventario, regreso al inventario, búsqueda y retorno con filtros, perfil público, chat con Enter/Shift+Enter y ausencia de errores JavaScript o recursos estáticos fallidos. Se revisan capturas sin desbordamiento horizontal del documento y tamaños calculados de controles, navegación y precio.
- Sintaxis de JavaScript, `git diff --check` y sincronización byte a byte de `static/` y `public/static/`.

### Reproducir el recorrido

Con PostgreSQL **local dedicado** disponible, definir `TEST_DATABASE_URL` a una base de control `grupo7_test*` con permisos para crear las bases temporales. La fixture rechaza destinos que no sean loopback. Usar el entorno Python de desarrollo y las instalaciones de Playwright/Chromium existentes:

```text
node tests/playwright/v715_publicacion.mjs <python.exe> <playwright/index.mjs> <chromium.exe> <directorio-evidencias>
```

El script inicia y cierra únicamente su servidor Flask y navegador; la fixture elimina su base desechable al finalizar. No añade dependencias de producción.

### Evidencias

En el directorio de evidencias indicado al ejecutar, fuera de Git:

- `cuenta-1920.png`
- `registro-validacion-1920.png`
- `fotografia-vista-previa-1920.png`
- `fotografia-guardada-1920.png`
- `ficha-publicada-1920.png`
- `inventario-1920.png`
- `catalogo-1920.png`
- `perfil-1920.png`
- `conversacion-1920.png`

## Límites

No se verifica Supabase Auth/Storage reales ni Vercel; no se realizan escrituras remotas. La base y persistencia de las operaciones del recorrido sí son PostgreSQL real aislado. La revisión visual se limita deliberadamente a 1920 × 1080; no constituye una nueva aprobación multidispositivo. No se repiten las suites completas anteriores ni se modifica código backend. La valoración visual sigue requiriendo revisión humana del PR. No hay merge ni despliegue manual a Production.
