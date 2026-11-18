# V7.17 · Perfil público del vendedor

El perfil reutilizaba el encabezado genérico y las tarjetas altas del catálogo. La acción de contacto se mostraba incluso a vendedores, aunque el chat solo admite compradores.

La nueva cabecera reúne nombre, rol y número de publicaciones visibles. El breadcrumb enlaza al catálogo y evita duplicar el retorno con un segundo enlace. El propietario conserva un acceso contextual a «Mis publicaciones» que depende del contexto emitido por Flask y de la sesión vigente.

El contador utiliza la lista que renderiza la página. Incluye vehículos vendidos y excluye retirados según la consulta existente. Las tarjetas reutilizan la misma plantilla y el mismo código de galería. La variante del perfil reduce el ancho de la foto y el espacio entre precio, estado y acciones en escritorio, conservando la ubicación, el año y el kilometraje. El catálogo conserva sus estilos.

El perfil conserva el contacto para visitantes y compradores en publicaciones disponibles. Flask establece el estado inicial para vendedores y la restauración de sesión actualiza las acciones. Los enlaces de ficha conservan el destino y la recuperación de posición. El endpoint público, la carga en lote y los permisos siguen usando los contratos vigentes.

Se modificaron `app.py`, `templates/index.html`, `static/js/interfaz.js`, `static/js/navegacion-cuenta.js` y `static/css/redesign-public-v6.css`, con sus copias de Vercel sincronizadas. El recorrido `tests/playwright/v714_perfiles.mjs` se amplió para cubrir la cabecera, la galería, el contador, los roles y el retorno.

La comprobación visual se limita a Chromium a 1920 × 1080 con PostgreSQL 17 aislado y dobles de Auth y Storage. Las pruebas de Python cubren contrato público, contexto y autorización del vendedor, y las de Node cubren la interfaz pública y restauración del contexto. El recorrido no verifica servicios de Production.
