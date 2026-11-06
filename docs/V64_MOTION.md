# V6.4 — Movimiento y microinteracciones

## Tokens

`static/css/motion.css` centraliza la escala de movimiento de las vistas públicas y administrativas V6:

| Token | Valor | Uso |
| --- | ---: | --- |
| `--motion-duration-feedback` | 140 ms | Aparición breve de validaciones y estados |
| `--motion-duration-state` | 180 ms | Hover, colores de estado, filtros y campos |
| `--motion-duration-panel` | 220 ms | Bandeja del comprador, confirmación y panel administrativo |
| `--motion-duration-panel-exit` | 150 ms | Cierre de diálogos |
| `--motion-duration-gallery` | 180 ms | Fundido entre fotografías |
| `--motion-duration-message` | 180 ms | Mensajes nuevos del chat |

Las entradas usan una curva de desaceleración y las salidas una curva de aceleración. El desplazamiento visual utiliza `transform` y `opacity`; los controles también pueden transicionar color y borde. No se usa `transition: all`.

## Comportamiento por componente

- Los botones y campos dan una respuesta breve. La presión se limita a controles habilitados que no estén procesando una operación; los controles deshabilitados no animan.
- Las tarjetas suben 3 px y sus fotos escalan a 1.02 solo con puntero preciso. No animan al cargar ni filtrar el inventario. Las flechas de la galería quedan fuera de la imagen transformada.
- Al abrir los filtros avanzados gira la flecha y aparece el grupo de campos.
- En Administración, `hidden`, `aria-current`, el menú móvil y el foco se actualizan de inmediato. El panel visible aparece con opacidad y un desplazamiento de 6 px; JavaScript no espera a que termine la animación.
- La bandeja del comprador y el diálogo para eliminar fotografías usan transiciones discretas de opacidad/transform y, cuando el navegador las admite, de `display`/`overlay`. El cierre nativo, bloqueo de scroll, foco, polling y estado del diálogo siguen siendo inmediatos.
- La foto siguiente se precarga antes del fundido. Un contador de generación descarta cargas atrasadas al navegar rápido; los errores conservan la ilustración de respaldo y actualizan el contador. Si se prefiere movimiento reducido o Web Animations no está disponible, la foto cambia sin animación.
- El historial del chat aparece sin efectos. Solo se animan los mensajes agregados por polling incremental o por un envío que acaba de completarse; la deduplicación por ID se mantiene.

## Accesibilidad y rendimiento

`prefers-reduced-motion: reduce` desactiva animaciones y transiciones, incluidos explícitamente los pseudo-elementos `::backdrop` de los diálogos del comprador y de administración. JavaScript también consulta esa preferencia para mostrar la fotografía al instante. Ninguna acción, cambio de foco, envío, solicitud ni ciclo de polling espera una animación. El hover solo aplica con `(hover: hover) and (pointer: fine)` y no cambia las dimensiones de las tarjetas.

La verificación Playwright usa respuestas interceptadas y datos ficticios. Bloquea las escrituras reales de la aplicación y no se conecta a Supabase ni Production. Durante el cambio de fotografía medido en Chromium local, el `layout-shift` observado fue 0.0000 y el rectángulo de la imagen mantuvo sus dimensiones. Es una medición puntual; no se afirma una mejora general de FPS ni de Core Web Vitals.
