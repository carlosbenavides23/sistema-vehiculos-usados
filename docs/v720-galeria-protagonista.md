# V7.20 · Ficha con galería protagonista

La ficha V7.19.2 usaba un marco panorámico de unos 822 × 421 px a 1920 × 1080. Las miniaturas quedaban debajo y podían ocupar dos filas. Una imagen 4:3 solo aprovechaba unos 562 × 421 px del marco.

La nueva ficha dedica aproximadamente el 69 % del ancho disponible a la galería. Mantiene el título y la ubicación antes de la foto. El precio, la disponibilidad, el vendedor y el contacto forman el panel derecho. Las especificaciones principales pasan debajo de la galería y el equipamiento adicional sigue en «Información del vehículo».

En escritorio, el encuadre tiende a 4:3, limita la altura a 530 px y conserva el centrado, el fondo neutro y `object-fit: contain`. Con una foto, la imagen ocupa todo el ancho del área y se ocultan las miniaturas, las flechas y el contador. Con varias, la columna de miniaturas admite desplazamiento y muestra un borde para la selección activa. Las flechas y el contador comparten el estado existente con las miniaturas. El cambio de selección puede desplazar la columna sin mover la página.

| Muestra de prueba | Foto visible en V7.19.2 | Foto visible en V7.20 |
| --- | ---: | ---: |
| Horizontal 4:3, una o varias fotos | 562 × 421 px | 707 × 530 px |
| Vertical 3:4 | 316 × 421 px | 398 × 530 px |

El aumento de aproximadamente 26 % por lado corresponde a la presentación, con los mismos archivos de origen. Las imágenes de baja resolución pueden verse más suaves al ampliarse. La comprobación visual usó fotos ficticias y Chromium a 1920 × 1080 con PostgreSQL aislado y dobles de Auth y Storage. Las capturas locales comparativas quedaron fuera de Git en `artifacts/v720/`.

Se modificaron `templates/index.html`, `static/css/redesign-public-v6.css` y `static/js/interfaz.js`, con sus copias de Vercel. Se amplió `tests/playwright/v714_perfiles.mjs` para comprobar el acceso a la última miniatura y su estado activo.

Las verificaciones abarcan fotos horizontales y verticales, cero, una o varias fotos, miniaturas fuera de vista, flechas, contador, respaldo, disponibilidad, contacto por rol, retornos, y ausencia de errores JavaScript o desbordamiento. Se ejecutaron los recorridos Playwright de perfil y sesión y pruebas localizadas de Node y Python. La verificación visual se limita al escritorio solicitado.
