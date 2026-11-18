# V7.16 · Identidad y navegación contextual por roles

La rama parte de `e223e13`, merge de V7.15. El mismo encabezado aparece en catálogo, fichas y perfiles. Un visitante ve «Explorar vehículos» e «Iniciar sesión». El comprador ve su nombre, su rol y un botón para abrir su bandeja. El vendedor ve su nombre, su rol y enlaces a `/vendedor` y `/vendedor#conversaciones`. La página raíz sigue siendo el catálogo para los tres estados.

La comprobación usa `GET /api/cuenta`. El encabezado y los componentes de cuenta y mensajería comparten la solicitud en curso. Una respuesta 401 deja disponible la navegación pública. Ante un fallo temporal, «Reintentar sesión» vuelve a solicitar la identidad sin cambiar de página. El nombre se coloca como texto y la autorización sigue a cargo de Flask.

Al iniciar sesión, el vendedor entra al panel. El comprador puede usar su cuenta para entrar a sus conversaciones. Un destino local de catálogo o ficha validado por la lista existente de `next` tiene prioridad, incluido el retorno de contacto. Quien ya tiene sesión puede abrir `/cuenta` para consultar su identidad.

«Cerrar sesión» usa el endpoint existente con CSRF y espera confirmación del servidor. Las pestañas intercambian únicamente un aviso de invalidación por BroadcastChannel. Al cambiar la sesión se invalidan las comprobaciones pendientes y el chat elimina sus datos privados. Al salir de una página se ocultan las vistas privadas antes de una posible restauración por el historial del navegador. Los borradores de la misma cuenta se conservan durante el uso normal del chat.

Los cambios se concentran en `templates/index.html`, `navegacion-cuenta.js`, `cuenta-sesion.js`, `cuenta.js`, `chat-cuentas.js`, `vendedor-chat-cuentas.js`, `admin-v6.js`, `archivo-chat.js` y `legibilidad-v715.css`. En `app.py` los accesos contextuales opcionales toleran un fallo PostgreSQL durante la comprobación de identidad. Los recursos de Vercel se sincronizan con `scripts/preparar_vercel.py`.

## Reproducción local

Desde la raíz del repositorio, configurar `TEST_DATABASE_URL` para un PostgreSQL local de pruebas con una base de control `grupo7_test*` y ejecutar:

```text
node tests/playwright/v716_sesion.mjs <python> <playwright/index.mjs> <chromium>
```

El recorrido usa solo 1920 × 1080, datos ficticios, PostgreSQL aislado y dobles de Auth/Storage. Comprueba la navegación de los tres roles, el retorno de contacto, la restauración tras recarga, la invalidación en dos pestañas, el rechazo sin CSRF y la recuperación de un error temporal. Complementa las pruebas de permisos del vendedor, cuenta, chat y retorno contextual. La comprobación no abarca los servicios remotos ni una matriz multidispositivo.
