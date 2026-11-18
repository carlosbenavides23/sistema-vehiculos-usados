# V7.19 · Optimización de la ficha completa

La ficha repetía la disponibilidad, el año y parte de las especificaciones. Además, separaba la descripción y el equipamiento en tarjetas independientes, y ofrecía contacto a cuentas vendedoras.

El título agrupa marca, modelo y año. La ubicación queda debajo y se conservan los enlaces de vuelta. El panel de precio reúne disponibilidad, kilometraje, tipo, combustible, transmisión y vendedor. Los valores opcionales ausentes se omiten.

«Información del vehículo» reúne la descripción y el equipamiento adicional. La descripción se inserta como texto y conserva los saltos de línea. El bloque de equipamiento aparece cuando hay datos y conserva los valores explícitos «Sí» y «No». El espacio de recomendaciones vuelve a la información del anuncio.

La acción de contacto espera la comprobación de sesión existente. Visitantes y compradores pueden contactar desde una ficha disponible con el flujo de retorno habitual. Para vendedores y vehículos vendidos, el enlace directo con `contactar=1` tampoco abre el chat. Los permisos, los endpoints y la galería mantienen sus contratos.

Cambios en `templates/index.html`, `static/js/interfaz.js`, `static/js/chat-cuentas.js`, `static/css/redesign-public-v6.css` y `static/css/legibilidad-v715.css`, con las copias correspondientes de Vercel. Los recorridos Playwright de publicación y sesión se adaptaron al título y al flujo contextual.

La verificación de escritorio a 1920 × 1080 con PostgreSQL 17 aislado y dobles de Auth y Storage cubre fichas simples y completas, vendidos, los cuatro contextos de sesión, contacto, retornos, descripción literal con saltos, galería y ausencia de desbordamiento. Se ejecutaron pruebas localizadas de Node (interfaz pública, galería y contexto) y de Python (retorno contextual, API de chat y sincronización de recursos). Las pruebas visuales se limitaron a Chromium en el entorno local.
