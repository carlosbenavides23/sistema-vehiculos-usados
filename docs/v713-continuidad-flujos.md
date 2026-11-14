# V7.13 — Navegación y continuidad

Base: `80a62da`, merge del PR #32. Se utilizó la copia local no versionada de `docs/evaluacion-flujos-marketplace-v713.md` del checkout principal; se conservó sin incorporarla al commit.

## Cambios

- **FL13-01:** los enlaces de ficha desde inventario indican `desde=inventario`. Flask verifica identidad, rol vendedor y propietario real antes de mostrar «Volver a mis publicaciones». El parámetro por sí solo no concede acceso; la ficha mantiene «Volver al catálogo». Las respuestas contextuales son privadas/no-store y aplican el mecanismo de cookies existente.
- **FL13-02:** el disparador global consulta la identidad actual. El vendedor accede a `/vendedor#conversaciones`, que selecciona la bandeja existente después de verificar la sesión. Comprador/visitante conservan el flujo del diálogo y acceso; contactar un vehículo conserva la comprobación de rol actual.
- **FL13-03:** el enlace al acceso conserva `contactar=1` en el retorno a fichas. Se reutiliza la validación de destinos de `cuenta.js` y la apertura existente de la ficha; no se crean mensajes ni conversaciones automáticamente.
- **FL13-04:** Enter solicita el submit del formulario actual; Shift+Enter conserva nueva línea. Composición IME, texto vacío y envío pendiente no disparan otro envío. Botón, CSRF, autorización, claves idempotentes y recuperación de errores permanecen en los manejadores existentes. Ambos editores explican el atajo.
- **FL13-06:** la navegación del vendedor incorpora «Explorar catálogo» hacia la ruta pública existente.

No se añadieron rutas, migraciones, perfiles públicos, cambios de permisos, duración de cookies ni configuración remota.

## Verificación localizada

- Python: `tests.test_v713_contexto` y `tests.test_cuentas`, **17 pruebas aprobadas**. Cubren visitante, comprador, propietario, vendedor ajeno y sesión inválida; el retorno no revela el UUID ni convierte el parámetro en autorización.
- Node: `test_v6_public_ui.mjs`, `test_v6_admin_ui.mjs`, `test_chat_cuentas_ui.mjs`, **10 pruebas aprobadas**. Comprobaciones de sintaxis y `git diff --check`.
- Playwright: `tests/playwright/v713_flujos.mjs`, exclusivamente **1920 × 1080**, Flask/PostgreSQL 17 aislados, Auth y Storage simulados. Verifica panel→ficha propia→panel, catálogo→bandeja del vendedor, recuperación del contacto tras login, conversación y ficha del comprador, ambos editores con Enter/Shift+Enter/IME/botón, envío pendiente sin duplicados y respuesta perdida con reintento de la misma clave, roles/propiedad ajena, sesión ausente y retorno externo rechazado. Sin excepciones JavaScript.

La prueba reutiliza `tests/fixture_v711_ui.py`, que crea y elimina una base UUID únicamente si `TEST_DATABASE_URL` es loopback y su base de control comienza por `grupo7_test`. Ejecución desde la raíz:

```text
node tests/playwright/v713_flujos.mjs <python-del-entorno> <playwright/index.mjs> <chromium.exe> <directorio-evidencias>
```

Capturas locales, excluidas del commit: `artifacts/v713-implementacion/ficha-propia.png` y `contacto-recuperado.png` en el checkout principal. Los recursos se sincronizan mediante `scripts/preparar_vercel.py`.

## Límites

Los recorridos usan identidades ficticias y servicios dobles; no acreditan Supabase Auth/Storage reales. No se ejecutó una batería multidispositivo ni suites completas. Quedan la comprobación con IME físico, lector de pantalla y otros navegadores. No se modificó Production ni se aplicaron migraciones remotas.
