# Tercer avance — Búsqueda y consulta del catálogo

**Proyecto:** Sistema de publicación y consulta de vehículos usados
**Curso:** Programación Estructurada, Universidad Americana (UAM), Managua
**Equipo:** Grupo 7
**Fecha programada:** 30 de octubre de 2026

## Alcance

El catálogo permite combinar una búsqueda de texto con disponibilidad, límites de precio en USD, rango de años y tipo de vehículo. La consulta puede ordenarse por precio o año; sin un orden explícito conserva el orden ascendente por identificador. Cada vehículo tiene una página pública compartible que carga los datos desde el API.

## Contrato de consulta

`GET /api/vehiculos` acepta `q`, `disponibilidad`, `precio_min`, `precio_max`, `anio_min`, `anio_max`, `tipo_vehiculo` y `orden`. Los filtros se combinan. Los precios aceptan hasta dos decimales y los años deben ser enteros. Los órdenes permitidos son `precio_asc`, `precio_desc`, `anio_asc` y `anio_desc`. Parámetros desconocidos, repetidos o inválidos devuelven HTTP 400 en el formato de error del API.

`GET /api/vehiculos/<id>` mantiene su respuesta `{ok, vehiculo}`, con fotografías asociadas. La placa se entrega únicamente a una sesión administrativa. `GET /vehiculo/<id>` renderiza la página pública; el navegador obtiene el detalle desde el API, que devuelve 404 para un identificador inexistente. La ruta compartible sirve el shell HTML y no realiza una consulta adicional a PostgreSQL.

## Decisiones de seguridad y datos

- Los filtros se ejecutan con parámetros SQL; las opciones de orden se limitan a una lista permitida.
- La respuesta pública no revela la placa. Las escrituras siguen protegidas por sesión administrativa y CSRF.
- No se requieren migraciones ni cambios al esquema. No se modificaron datos, credenciales ni recursos remotos de Supabase.
- Los errores de búsqueda no exponen detalles internos de PostgreSQL.

## Verificación

La suite completa pasó **79/79 pruebas** en un clúster PostgreSQL local aislado; Storage se simuló en las pruebas de flujo para evitar operaciones remotas. Las regresiones incluyen consulta SQL real con filtros combinados y orden, integración Flask/PostgreSQL de la búsqueda y ficha, errores de parámetros, privacidad de placa, CSRF, CRUD, fotos y empaquetado de estáticos para Vercel. No se conectó a Supabase remoto.
