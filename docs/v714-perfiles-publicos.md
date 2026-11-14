# V7.14 — Perfiles públicos de vendedores

Base: `1ffc08e`, merge del PR #33. No se requieren migraciones ni cambios remotos.

## Contrato y privacidad

- `GET /vendedores/<uuid>`: página pública con nombre fijo, condición de vendedor, publicaciones y estado vacío. El acceso «Mis publicaciones» solo se presenta después de verificar identidad y rol del propietario en Flask; el parámetro de navegación no concede permisos. La respuesta HTML es privada/no-store por contener navegación contextual.
- `GET /api/vendedores/<uuid>`: `{ok, vendedor: {nombre, url}, vehiculos: [...]}`. UUID inexistente, comprador o perfil no registrado: 404. No admite escrituras.
- Los anuncios de las APIs existentes incorporan `vendedor: {nombre, url}` o `null` para legado sin perfil vendedor identificable. El navegador no proporciona la identidad ni el nombre.
- Se reutiliza el UUID existente como identificador opaco de lectura pública. Es estable y evita nombres como claves, colisiones o migraciones. No es un secreto: permite correlacionar el perfil con su UUID de cuenta. Nunca se acepta como prueba de identidad; las escrituras continúan resolviendo sesión, rol y propietario en servidor. Si posteriormente se exige evitar esa correlación, hará falta una identidad pública separada y su migración; no se simula aquí un anonimato inexistente.
- Solo se proyectan nombre y URL del perfil. No se divulgan correo, teléfono, cookies, tokens, verificadores, placa ni metadata Auth. El nombre se trata como texto y Jinja lo escapa. No hay edición de nombre, biografía, reputación o verificación ficticia.

## Consultas y navegación

`perfiles_publicos.py` consulta exclusivamente `perfiles_usuarios` y `roles_usuarios` para identificar vendedores. El catálogo resuelve todos los propietarios con una consulta `ANY(uuid[])`, no una por tarjeta. Las fotografías mantienen su carga en lote. Un perfil usa una consulta de identificación, otra de sus anuncios no retirados y el lote de fotografías. Los vendidos siguen visibles, igual que en el catálogo.

Se reutilizan `index.html`, las tarjetas, galerías y estilos V6. El nombre aparece como enlace discreto en tarjetas del catálogo y en el panel de precio de la ficha. Dentro del perfil no se repite un enlace circular a sí mismo en cada tarjeta.

El recorrido catálogo → ficha → perfil → otra ficha → contacto usa las rutas existentes de ficha y chat. Desde una ficha abierta en el perfil se muestra «Volver al perfil del vendedor», además de «Volver al catálogo». Se valida que el retorno sea del mismo origen y pertenezca al catálogo o a un perfil. El estado temporal de posición incluye ahora la ruta, para no confundir una lista de vendedor con el catálogo general. Los controles de búsqueda y ordenamiento del catálogo no se modifican; el perfil es una lista de ese vendedor y no presenta filtros propios.

Inventario → ficha propia conserva «Volver a mis publicaciones» de V7.13; el perfil del propietario también presenta «Mis publicaciones». Visitantes, compradores y vendedores ajenos no obtienen ese acceso contextual.

## Archivos

`perfiles_publicos.py`, `app.py`, `templates/index.html`, `static/js/interfaz.js`, `static/css/redesign-public-v6.css` y sus copias CDN. Regresiones en `tests/test_perfiles_publicos.py` y `tests/playwright/v714_perfiles.mjs`.

## Pruebas

- **24 pruebas Python aprobadas:** seis nuevas de perfiles con PostgreSQL 17 aislado (75 vehículos de dos propietarios), 17 regresiones de cuenta/contexto V7.13 y una regresión PostgreSQL de propiedad entre dos vendedores, comprador y legado.
- **10 Node aprobadas** de catálogo, panel y chat; sintaxis JavaScript y `git diff --check`.
- **Playwright 1920 × 1080**, sin batería multidispositivo: perfil sin sesión, enlace desde tarjeta/ficha, otra publicación y contacto, perfil propio e inventario, comprador en perfil ajeno, vendedor vacío, legado neutral, privados omitidos, retirados excluidos y vendidos visibles.
- Recorrido Playwright V7.13 aprobado: autenticación/contexto, propiedad, sesiones, Enter/Shift+Enter, IME y reintentos en ambos roles.
- Auth/Storage simulados; PostgreSQL real únicamente local. Las bases UUID se eliminan por la fixture. El primer intento de la regresión adicional de propiedad no inició por ausencia de `FLASK_SECRET_KEY` ficticia; se configuró localmente y la prueba pasó.

Las capturas locales están fuera del commit, en `artifacts/v714/perfil-publico.png` del checkout principal. Se sincronizan recursos con `scripts/preparar_vercel.py`.

## Limitaciones

No se acredita integración remota real ni despliegue. Quedan IME físico, lector de pantalla, otros navegadores y adaptación visual fuera del viewport solicitado. No se añadieron perfiles a cuentas antiguas sin nombre: sus anuncios muestran una alternativa neutral hasta que exista un perfil válido. No se modificaron permisos, nombres, roles, vehículos reales, autenticación, cookies o esquema.
