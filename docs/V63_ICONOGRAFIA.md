# V6.3 — Iconografía local con Lucide

## Fuente y atribución

Los iconos se fijan a **Lucide 1.62.0** y se descargaron desde los SVG oficiales de la etiqueta `1.62.0` del repositorio `lucide-icons/lucide`. Los SVG originales seleccionados, sus SHA-256, el manifiesto y la licencia se conservan en `vendor/lucide/1.62.0/`. La licencia ISC completa incluye también la nota MIT aplicable a los iconos derivados de Feather. El sprite de entrega se genera con `python scripts/generar_lucide_sprite.py`; no se edita manualmente.

## Arquitectura

- `vendor/lucide/1.62.0/icons/`: única fuente vectorial de los 24 iconos utilizados.
- `static/img/icons/lucide-sprite.svg`: sprite local generado a partir de esos SVG, con símbolos de `viewBox="0 0 24 24"`, `currentColor`, trazo 2 y extremos/uniones redondeados.
- `templates/macros/icons.html`: macro Jinja para las plantillas; solo emite nombres del conjunto permitido y oculta los iconos decorativos a tecnologías asistivas.
- `static/js/iconos.js`: constructor DOM seguro para controles que se creen desde JavaScript. Valida nombre, tamaño y clases; crea SVG mediante `createElementNS` y no inserta HTML arbitrario.
- `static/css/iconos.css`: estilo base compartido para los iconos inline.
- `scripts/preparar_vercel.py`: copia el sprite desde `static/` hacia `public/static/` para el CDN, sin instalar ni compilar frontend en Production.

## Inventario de reemplazos

| Uso anterior | Equivalente Lucide | Ubicación actual |
| --- | --- | --- |
| `img/ui/message.svg` | `message-circle` | Acceso «Mis mensajes» |
| `img/ui/search.svg`, `img/admin-v6/search.svg` | `search` | Búsqueda pública, vacíos y filtro administrativo |
| `img/ui/sliders.svg` | `sliders-horizontal` | «Más filtros» |
| `img/ui/pin.svg` y fondo CSS de ubicación | `map-pin` | Ubicación en tarjetas y ficha |
| `img/ui/calendar.svg` y fondo CSS de año | `calendar-days` | Año de la tarjeta y ficha |
| `img/ui/gauge.svg` | `gauge` | Kilometraje |
| `img/ui/gear.svg` | `settings-2` | Transmisión |
| `img/ui/fuel.svg` | `fuel` | Combustible |
| `admin-v6/menu.svg`, flechas y `×` en HTML/CSS | `menu`, `arrow-left`, `chevron-left`, `chevron-right`, `x`, `rotate-ccw`, `chevron-down` | Acceso móvil, regreso/cierre, galerías, filtros y selects |
| `admin-v6/lock.svg` | `lock-keyhole` | Acceso administrativo |
| `admin-v6/car.svg` | `car-front` | Navegación de inventario |
| `admin-v6/message.svg`, puntos del estado vacío | `messages-square` / `message-circle` | Navegación administrativa y chat vacío |
| `admin-v6/plus.svg`, `plus-20.svg` | `plus` | Registrar vehículo |
| `admin-v6/logout.svg` | `log-out` | Cerrar sesión |
| `admin-v6/back.svg` | `arrow-left` | Volver al inventario y a conversaciones |
| `admin-v6/check.svg` | `check` | Guardar/publicar |
| `admin-v6/image.svg` | `image` | Gestión de fotografías |
| `admin-v6/send.svg` | `send` | Respuesta administrativa |
| Unicode `⌕`, `←`, `→`, `‹`, `›`, `×`, `↺`, `⌄` | `search`, `arrow-left`, `chevron-left`, `chevron-right`, `x`, `rotate-ccw`, `chevron-down` | Estados, navegación y acciones |

`static/img/vehiculo.svg`, fotografías cargadas, previews de imagen y marcas textuales del encabezado son contenido/identidad, no iconografía de interfaz; se conservan. No se reemplazan imágenes de vehículos ni marcas por iconos.

## Verificaciones

El test Python comprueba los SHA-256 de las fuentes fijadas, la estructura y símbolos del sprite, referencias locales válidas, ausencia de rutas antiguas y sincronía con `public/static/`. La prueba Node ejecuta el constructor JavaScript con DOM simulado y comprueba allowlist, atributos accesibles y rechazo de valores inseguros. La integración visual se verifica en navegador con catálogo, ficha, chat y acceso/panel administrativo en 320, 390, 768, 1024 y 1440 px.
