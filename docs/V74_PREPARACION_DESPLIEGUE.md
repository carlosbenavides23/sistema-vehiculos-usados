# V7.4 — Preparación segura de despliegue

Esta configuración prepara un opt-in controlado. V7 permanece apagada por defecto; esta versión no aplica migraciones, no crea cuentas y no modifica servicios remotos.

## Variables

| Variable | Uso |
| --- | --- |
| `USER_AUTH_ENABLED` | Opt-in general de V7. `false` o ausente deshabilita todas las rutas V7. |
| `V7_PRODUCTION_ENABLED` | Segunda autorización explícita requerida únicamente cuando `VERCEL_ENV=production`. Debe permanecer `false` hasta completar las verificaciones previas. |
| `DATABASE_URL` | Conexión PostgreSQL. V7 valida formato PostgreSQL; el driver mantiene TLS obligatorio fuera de loopback de prueba. |
| `SUPABASE_URL` | URL HTTPS del proyecto Supabase para Auth. |
| `SUPABASE_PUBLISHABLE_KEY` o `SUPABASE_ANON_KEY` | Clave pública de Auth para la solicitud servidor a servidor; nunca se envía al navegador por esta política. No usar una clave de servicio para Auth. |
| `FLASK_SECRET_KEY` | Clave de firma con al menos 32 caracteres. |
| `SESSION_COOKIE_SECURE` | Debe ser segura bajo HTTPS; Vercel Preview y Production la fuerzan a `true`. |
| `APP_READ_ONLY` | Modo global heredado. No activa V7. Preview fuerza solo lectura aunque el valor diga `false`. |

La validación se limita a presencia y formato local y no abre conexiones durante el arranque ni la importación de Flask. No informa al navegador cuál dependencia falta. En pruebas locales se permiten dobles explícitos de Auth junto con un repositorio inyectado o la base PostgreSQL local aislada.

## Política por entorno

- **Local:** V7 deshabilitada por defecto. Para pruebas aisladas se puede habilitar mediante configuración de prueba e inyectar Auth falso; no usar credenciales de Production.
- **Preview:** con `USER_AUTH_ENABLED=true` y dependencias válidas puede servir lecturas autenticadas si su propia configuración está aislada. Siempre fuerza `APP_READ_ONLY=true` y cookies `Secure`; rechaza registro/login, mensajes y cambios de publicaciones. Ninguna variable puede quitar este bloqueo. Separar siempre las variables de Preview de las de Production.
- **Production:** sin ambas autorizaciones V7 está deshabilitada. Mantener `USER_AUTH_ENABLED=false` y `V7_PRODUCTION_ENABLED=false` hasta tener respaldo restaurable, migraciones ordenadas, permisos/trigger probados y ensayo real de Supabase Auth en un proyecto aislado. `APP_READ_ONLY=false` por sí sola nunca habilita V7.

El chat anónimo V6 tiene su propio flag `CHAT_ENABLED`; esta política no lo cambia ni lo habilita automáticamente. El acceso administrativo V6 y las operaciones de catálogo conservan su control global de lectura.

## Orden obligatorio de migración y despliegue

Las versiones V7 consultan `vehiculos.vendedor_id`, por lo que **desplegar primero código V7 con esquema V6 incompleto no es compatible**, aunque `USER_AUTH_ENABLED=false`.

1. Confirmar respaldo restaurable de Production y restauración ensayada en un entorno aislado.
2. Aplicar una sola vez y en orden registrado: `20261112002005_v71_roles_usuarios.sql` (V7.1), `20261112004250_v72_propiedad_vehiculos.sql` (V7.2), `20261112010722_v73_chat_cuentas.sql` (V7.3). La base debe incluir previamente la migración V6.5.4 de retiro lógico.
3. Verificar tablas, columnas, triggers, restricciones, RLS, grants, propietario de funciones, rol Flask y conservación del inventario y conversaciones.
4. Ensayar Auth real, alta de rol y sesión en un proyecto Supabase aislado; comprobar cookies HTTPS, lectura, escritura autorizada y revocación. Los dobles locales no acreditan integración real.
5. Desplegar el código con `USER_AUTH_ENABLED=false` y `V7_PRODUCTION_ENABLED=false`; comprobar catálogo, administración V6, fotografías y chat V6 sin cambios.
6. Solo tras aprobación operativa independiente, configurar las dos autorizaciones en Production y volver a desplegar deliberadamente. Este PR no realiza esos pasos.

## Comprobaciones posteriores al despliegue

Confirmar commit y despliegue READY; `GET /api/cuenta` debe permanecer no autenticado sin exponer secretos. Revisar la página de acceso, cookies HttpOnly/SameSite/Secure, `Cache-Control: no-store`, error genérico sin credenciales, y acceso de comprador/vendedor limitado por rol y propietario. Verificar que no existe escritura al catálogo V6 por la sesión de vendedor. Ejecutar casos con cuentas de prueba autorizadas y datos ficticios, nunca con vehículos/conversaciones de Production como datos de prueba. Confirmar que Preview rechaza POST y no renueva tokens cuando está en solo lectura.

## Desactivación rápida

Para cerrar V7 sin afectar el catálogo público ni el chat anónimo V6, cambiar `USER_AUTH_ENABLED=false` en el ambiente afectado y publicar una nueva versión de configuración/despliegue. En Production también se puede volver `V7_PRODUCTION_ENABLED=false` como barrera adicional. Mantener `APP_READ_ONLY` y `CHAT_ENABLED` según la operación V6; no es necesario cerrar catálogo, imágenes ni sesión administrativa V6. Las cookies V7 dejan de autorizar rutas y expiran por su plazo; la desactivación no borra usuarios, mensajes ni datos.

## Estado de integración

Las pruebas automatizadas locales utilizan dobles de Supabase Auth. No hay un proyecto Supabase V7 de pruebas y no se ha verificado la integración real de Auth en este cambio. No se aplicaron migraciones remotas ni se cambiaron variables de Vercel.
