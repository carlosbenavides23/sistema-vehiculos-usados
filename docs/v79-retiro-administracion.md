# V7.9 — Retiro de la administración compartida

## Dependencias conservadas y retiradas

`admin_v6.html`, `admin-v6.js`, CSS, preparación de imágenes y `admin-v6-field-values.js` son componentes del vendedor: se conservan inventario, validación accesible, fichas V7.7, protección de cambios pendientes, reservas fotográficas, idempotencia, disponibilidad/deshacer y retiro. El nombre histórico del archivo no implica privilegios globales. La navegación agrega un enlace al archivo histórico y respeta la protección de cambios sin guardar.

Se retiraron las ramas de login por contraseña, hash administrativo, limitador del login global, bandeja anónima de escritura y sus listeners/polling del frontend compartido. Se eliminaron `static/js/chat.js` y su copia CDN. `interfaz.js` ya no consulta `/api/admin/session` ni muestra «Administrar». El panel usa `/api/vendedor/session` y el logout real de `/api/cuenta/logout`.

La persistencia de fotografías continúa usando `propiedad.condicion()`; sin contexto vendedor, su ámbito heredado sigue disponible para herramientas operativas explícitas y pruebas. Ninguna ruta HTTP de escritura usa ese ámbito: las funciones compartidas solo están registradas bajo `/api/vendedor/` y exigen identidad vendedora y CSRF. No se cambió el esquema ni `vendedor_id` de ningún registro remoto.

`persistencia_chat.py` se conserva: sus validadores, límites y excepciones son reutilizados por `persistencia_chat_cuentas.py`. Las tablas históricas y los módulos de mantenimiento existentes no se borran. Las antiguas funciones de escritura anónima ya no están expuestas por Flask. Las migraciones históricas permanecen intactas.

## Rutas y autorización

- `/administracion` redirige a `/cuenta`, sin formulario ni acceso privilegiado.
- `/api/admin/login`, `/api/admin/logout`, `/api/admin/session`, inventario y chat administrativos desaparecen.
- `/api/chat/*` anónimo desaparece, incluidos emisión de sesión y envío. `CHAT_ENABLED=true` ya no habilita rutas.
- `/api/vehiculos` y `/api/vehiculos/<id>` conservan GET/HEAD; sus métodos de escritura responden 405. Subrutas antiguas sin GET responden 404.
- `/api/vendedor/vehiculos/*` conserva CRUD permitido, fotografías y retiro lógico con sesión Auth verificada, rol vendedor, UUID y propiedad del registro. La placa solo se serializa en solicitudes privadas del propietario.
- `/api/cuenta/chat/*` conserva autorización y contratos del chat privado.

La cookie Flask antigua se puede verificar criptográficamente, pero `admin_authenticated` se elimina y nunca se considera autorización. Cookies antiguas de visitante se expiran al recibirse. Se conservan la firma de sesión Flask, CSRF, cookies HttpOnly/SameSite/Secure y las revocaciones de cuentas. Errores de Auth no autorizan solicitudes y no exponen detalles del proveedor. Las respuestas privadas y del archivo usan `Cache-Control: no-store`.

El archivo reutiliza la señal de invalidación de cuentas entre pestañas: al cerrar sesión o cambiar de cuenta borra los mensajes del DOM y vuelve a `/cuenta`. Si el navegador restaura la página desde su caché de navegación, limpia el contenido y recarga para volver a comprobar la autorización. No se transmiten mensajes, identidades ni credenciales por ese canal.

## Archivo histórico

`/vendedor/archivo` lista solamente conversaciones anónimas de vehículos cuyo `vendedor_id` actual corresponde al UUID verificado. `/vendedor/archivo/<uuid>` vuelve a comprobarlo para cada hilo y cada página. Un vendedor ajeno recibe 404, igual que para un hilo inexistente; comprador recibe 403 y usuario sin sesión 401. También admite vehículos retirados, conservando acceso al historial.

`archivo_chat.py` selecciona únicamente vehículo, estado, remitente, contenido y fecha. Nunca devuelve visitante UUID, verificador de sesión, cookies, huellas ni claves de idempotencia. Los mensajes se escapan con Jinja y se presentan como texto. No hay formulario de respuesta ni métodos de escritura. La lista pagina de 50 en 50 por UUID y el hilo de 100 en 100 por ID, sin truncar el archivo. El orden UUID no representa cronología; cada hilo conserva el orden original de los mensajes.

Las cuatro conversaciones históricas permanecen en sus tablas. No se asignan cuentas ficticias a visitantes ni se convierten chats a cuentas. No se requiere migración ni permisos nuevos: se reutiliza la conexión privada de Flask y las relaciones existentes. No se cambian políticas RLS ni privilegios de Data API.

## Pruebas y revisión

Se añadieron pruebas PostgreSQL locales con 18 vehículos ficticios transferidos, dos vendedores, un comprador, fotografía y cuatro chats históricos: inventario, cookie V6 sin privilegios, rutas retiradas, CSRF, sesiones revocadas, archivo autorizado, aislamiento, XSS, conservación de filas y paginación. Las regresiones existentes de API/CRUD/fotografías e integración se adaptaron para pasar por el vendedor; se conservaron sus validaciones y fallos parciales. Se retiraron pruebas exclusivas de endpoints y controles que ya no existen, conservando pruebas de la persistencia histórica y del chat privado.

Playwright utiliza Flask/PostgreSQL locales y un doble de Supabase Auth, a 1440 y 390 px: catálogo sin acceso global, panel, archivo con cuatro conversaciones, navegación, bloqueo de otra cuenta, chat privado y logout. Las capturas quedan fuera de Git. Esto no prueba la integración remota real con Supabase Auth ni los datos reales del proyecto.

Resultados: 44 pruebas Python de API/CRUD/fotografías/cuentas; 10 pruebas PostgreSQL de seguridad V7.9, vendedor, flujo integral y chat privado; 5 pruebas de recursos; 43 pruebas Node, todas aprobadas. Playwright aprobó los recorridos V7.9 y V7.7 en ambas resoluciones, incluyendo edición de precio con conservación de tipo histórico y cierre de sesión con el archivo abierto en otra pestaña. No hubo pruebas PostgreSQL omitidas en estas suites localizadas. No se ejecutó la batería integral no relacionada.

## Preparación posterior de Production

No se modificaron Production, datos, propiedad, roles, variables Vercel ni Supabase. No hay migraciones que aplicar para V7.9. Antes de publicar, confirmar el despliegue V7 vigente, inventario transferido y acceso real del vendedor. Mantener `USER_AUTH_ENABLED`, `V7_PRODUCTION_ENABLED`, configuración Supabase Auth, PostgreSQL/Storage y clave de sesión segura existentes; no rotar secretos como parte de este retiro.

`ADMIN_PASSWORD_HASH` y `CHAT_ENABLED` son variables obsoletas y se pueden eliminar de la configuración durante una operación posterior autorizada; este código no las consulta. Preview sigue siendo de solo lectura. Confirmar manualmente con la cuenta real, mediante consultas, que las 18 publicaciones y los cuatro hilos aparecen tras publicar. No crear mensajes ni vehículos de prueba en Production. Un rollback de código no requiere revertir datos o migraciones de esta entrega.
