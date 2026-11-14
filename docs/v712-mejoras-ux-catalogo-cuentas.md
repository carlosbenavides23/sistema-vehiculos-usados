# V7.12 — Catálogo, filtros y cuentas

Base: `7964c2c`. El diagnóstico previo se encuentra en la copia local `docs/benchmark-ux-marketplace-v712.md`; no estaba versionado en `main` y se conservó sin incorporarlo al commit.

| Hallazgo | Cambio |
|---|---|
| BX12-D01 | El encabezado móvil usa el identificador vigente del botón de conversaciones y mantiene su nombre accesible. |
| BX12-D02 | Los errores estructurados de validación se muestran junto a los campos y se distinguen de errores del servicio. |
| BX12-O01 | El retorno público conserva el contexto del anuncio y restaura su posición después de reconstruir los resultados. |
| BX12-O02 | Los filtros aplicados se muestran con su valor y pueden retirarse individualmente; en móvil hay una acción de envío al final de los filtros avanzados. |
| BX12-D03/D04 | La cuenta muestra título según el estado y el registro no promete una confirmación que depende del proveedor. |
| BX12-O04 | El primer inventario vacío invita a publicar; una búsqueda vacía mantiene la opción de limpiar filtros. |

Se mantiene el mismo formulario y la misma lógica de envío para el botón móvil adicional. La posición de navegación pública usa almacenamiento de sesión del navegador para un identificador de anuncio y parámetros de búsqueda, sin mensajes ni credenciales. No se agregan filtros ni campos de negocio.

Los cambios abarcan las plantillas públicas y de cuenta/vendedor; `interfaz.js`, `cuenta.js`, `admin-v6.js`, estilos responsive y copias de `public/static/`; las regresiones de navegador y su fixture local están en `tests/`.

Las capturas se guardan fuera del commit en `artifacts/v712/` del checkout local principal. Las pruebas utilizan PostgreSQL local aislado, Auth y Storage simulados; no prueban los proveedores remotos ni sustituyen una revisión con lector de pantalla o dispositivos físicos. Se descartaron perfiles públicos, nuevos filtros, paginación y rediseños por quedar fuera de la autorización.

## Verificación

- Python: 31 pruebas de cuentas y vehículos aprobadas.
- Node: 10 pruebas localizadas de catálogo, panel y chat aprobadas; comprobaciones de sintaxis y `git diff --check` sin errores.
- Playwright: filtros, rangos de precio/año, retirada individual, orden, historial, anuncio ausente y 503 a 390, 768, 1024 y 1440 px, con 80 vehículos ficticios. Cuenta con sesión inmediata y confirmación pendiente, y estados vacíos del vendedor a 390 y 1440 px.
- Encabezado, ficha y chat se verificaron a los cuatro anchos con la fixture aislada del benchmark: 83 publicaciones visibles, galería, borrador, Escape y retorno del foco. Las capturas están en `artifacts/v712/`, `artifacts/v712/filtros/`, `artifacts/v712/cuenta/` y `artifacts/v712/inventario/` del checkout principal.
- Se ejecutó `scripts/preparar_vercel.py` para sincronizar los recursos. Pendientes de revisión manual: lectores de pantalla, navegadores distintos de Chromium y dispositivos móviles físicos.
