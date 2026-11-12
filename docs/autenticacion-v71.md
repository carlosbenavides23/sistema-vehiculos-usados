# Cuentas V7.1 (preparación interna)

Aplicar la migración de roles y sesiones antes de habilitar `USER_AUTH_ENABLED=true` en un entorno aislado. La aplicación fuerza las rutas de cuentas a permanecer deshabilitadas cuando `VERCEL_ENV=production`. Preview de cuentas requiere Auth y PostgreSQL separados de Production.

Configurar `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (o `SUPABASE_ANON_KEY`), `DATABASE_URL`, `FLASK_SECRET_KEY` y cookies Secure bajo HTTPS. No se usa una clave administrativa de Auth ni se almacenan contraseñas. En Authentication → Providers → Email, desactivar Confirm email para el prototipo si se autoriza; con confirmación activa el registro informa que se revise el correo. No se cambió esa opción remotamente.

Supabase crea la identidad; el trigger de alta copia el rol elegido a una tabla privada en la misma transacción. Cambiar metadatos del usuario posteriormente no altera el rol; un trigger impide modificar rol o UUID. La migración instala la FK y el trigger de alta cuando existe `auth.users` (Supabase); en PostgreSQL de pruebas sin Auth solo prepara las tablas. No habilitar cuentas en una instancia sin Auth y sin ese trigger.

Los tokens de acceso y renovación viajan exclusivamente en cookies HttpOnly/SameSite=Lax, Secure en HTTPS. Una tercera cookie opaca corresponde a un hash de sesión en PostgreSQL con vencimiento absoluto de siete días. Flask verifica el usuario mediante Auth y consulta el rol en cada acceso privado. El cierre elimina la sesión local y solicita revocar el refresh token en Auth; si falla la solicitud remota se informa y la sesión local queda invalidada. La revocación externa puede tardar hasta expirar el JWT de acceso. Los borradores y permisos de V6 no se migran.

Las rutas `/cuenta/comprador` y `/cuenta/vendedor` comprueban el rol; no ofrecen todavía administración de vehículos ni perfiles. El vendedor no recibe `admin_authenticated`. La prueba PostgreSQL utiliza una tabla `auth.users` local mínima para verificar el trigger, no un servidor Supabase Auth. Las pruebas HTTP y visuales usan dobles de Auth; queda pendiente comprobar el proveedor real en un proyecto aislado antes de habilitar V7.
