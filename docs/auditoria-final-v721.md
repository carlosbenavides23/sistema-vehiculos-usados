# Auditoría final de aceptación V7.21

**Fecha:** 18 de noviembre de 2026.  
**Referencia auditada:** `336bf7f3834c11caae0cd9e96d6417a090ff5715` (`origin/main`).  
**Navegador:** Chromium, escritorio 1920 × 1080.  
**Veredicto:** **APTO CON OBSERVACIONES**.

> Esta copia para el repositorio resume fielmente el informe local de Codex. Las capturas generadas en directorios temporales no se versionaron: sus rutas absolutas se omiten para no ofrecer enlaces rotos ni exponer rutas del equipo. No se han reejecutado pruebas para redactar este documento.

## Resumen ejecutivo

La búsqueda pública, ficha con fotografía WebP de Storage y perfil del vendedor se comprobaron en Production. Autenticación, autorización, persistencia y recorridos privados se validaron localmente con PostgreSQL aislado, datos ficticios y dobles de servicios externos. El entorno remoto se usó **solo para consultas públicas**. No se modificaron Production, datos, esquema, despliegues ni configuraciones.

## Matriz de aceptación

| Módulo / escenario | Evidencia resumida | Resultado |
| --- | --- | --- |
| Production: disponibilidad y recursos | Inicio y catálogo JSON 200; CSS, JS, fuente Inter y sprite SVG 200 con tipos MIME correctos; WebP 596 × 335 px cargada sin errores JS. Los 401 fueron consultas de sesión de visitante. | APROBADO |
| Production: visitante, ficha y perfil | Búsqueda Toyota, apertura de `/vehiculo/1`, perfil del vendedor con 18 publicaciones. La API pública limitó el vendedor a nombre y URL y no publicó placa, correo ni ID interno de propietario. | APROBADO |
| Catálogo local: filtros y galería | Búsquedas Toyota/Corolla/Estelí, combinaciones de disponibilidad y precio, orden, vendido, retorno con filtros, vacío, limpieza, galería de cinco fotos y restauración de desplazamiento. | APROBADO |
| Vercel y `main` | Despliegue `dpl_CsBLh6HHkiZSikNDqwak8o9oYJRY`, READY, rama `main`, SHA auditado. | APROBADO |
| Cuentas y sesiones | Registro con roles, confirmación pendiente, nombre y rol inmutables, cookies, CSRF, expiración, revocación y salida; Auth simulado. | APROBADO |
| Registro visible comprador/vendedor | Registro desde catálogo; comprador a bandeja vacía y vendedor a inventario vacío con acción de primera publicación. | APROBADO |
| Comprador recurrente | Login contextual desde ficha, historial, mensajes consecutivos/Enter/Shift+Enter, recuperación sin duplicados, vista previa larga, historial retirado de solo lectura y limpieza al cambiar de cuenta. | APROBADO |
| Vendedor y respuesta | Panel, bandeja, consulta Toyota, lectura, respuesta, teclado, recuperación de respuesta perdida e idempotencia. | APROBADO |
| Permisos de chat | `test_chat_cuentas_api` y `test_chat_cuentas_http_postgres`: identidad ajena, rol, vencimiento, CSRF, reintentos, participantes y retiradas. | APROBADO |
| Propiedad, disponibilidad y retiro | `test_vendedor_postgres`: aislamiento entre vendedores, retiro/edición concurrentes y retiro/reserva fotográfica con conexiones independientes. | APROBADO |
| PostgreSQL y fotografías | `test_flujo_integral`: alta idempotente, actualización, CSRF, sustitución/eliminación y recuperación ante fallos simulados de Storage o guardado. | APROBADO |
| Navegador: inventario y edición | Búsqueda, filtros, vendido/reversión, cambio de precio, advertencia de cambios sin guardar y retiro confirmado. | APROBADO |
| Navegador: alta y fotos | Validación de siete campos, creación con foto, sustitución y eliminación posterior, con recuento comprobado. | APROBADO |
| Preview: solo lectura | `test_politica_v7` y `test_cuentas`: bloqueo de registro/escrituras y revocación permitida, **mediante configuración local simulada**. | APROBADO |
| Integraciones privadas remotas | Sin comprobación de login real, mensajes, escrituras PostgreSQL/Storage o Preview remoto. | NO VERIFICADO |

## Pruebas y cobertura

- **28 pruebas localizadas aprobadas** de cuentas, chat y política V7.
- **8 pruebas con PostgreSQL 17 aislado aprobadas** sobre persistencia, propiedad, chat y concurrencia.
- Un primer intento de ejecución omitió cuatro pruebas PostgreSQL; se ejecutaron posteriormente en el entorno de prueba. Un problema inicial de catálogo interno en un clúster de PostgreSQL copiado fue tratado como defecto de infraestructura, no del producto.
- Se reutilizó evidencia previa de V7.20.2–V7.20.5; esta auditoría no repitió matrices móviles, suites completas ni toda la comprobación multinavegador del PR #50.
- Production se inspeccionó con GET/HEAD públicos, sin cuentas ni operaciones remotas de escritura.
- Se detuvieron servidores de prueba. La política del entorno impidió eliminar recursivamente dos copias temporales de PostgreSQL; quedaron detenidas. El informe local original identificaba sus rutas para limpieza posterior, previa verificación de que no fueran clústeres originales.

## Hallazgos y límites

**Defectos confirmados:** no se identificaron P0/P1; tampoco P2/P3 confirmados que afectaran los recorridos ejecutados.

**Evidencia descartada:** selectores y expectativas de scripts históricos ocasionaron fallos de automatización que no correspondían a defectos de la aplicación; se ajustaron solo las copias temporales de los guiones de prueba.

**Riesgo pendiente:** la configuración y el estado de las integraciones Auth/PostgreSQL/Storage en Production pueden diferir de los dobles locales. No se demostraron remotamente registro real, envío de mensajes, cargas a Storage, escrituras ni el comportamiento de un Preview desplegado.

**Mejoras opcionales:** ninguna propuesta en esta auditoría; la evaluación se limitó a aceptación, seguridad y estabilidad.

## Preparación de la demostración

| Recorrido | Estado | Preparación pendiente |
| --- | --- | --- |
| A. Visitante | Demostrado en Production | Reutilizar catálogo, búsqueda Toyota, ficha y perfil públicos. |
| B. Comprador | Demostrado localmente | Verificar cuenta real de demostración, vehículo disponible y conversación preparada antes de usar Production en vivo. |
| C. Vendedor | Demostrado localmente | Verificar cuenta propietaria, anuncio ficticio y foto apta para la demostración remota. |

La preparación de cuentas y datos **no se realizó** en esta auditoría.

## Veredicto

**APTO CON OBSERVACIONES.** Los tres recorridos se completaron en sus respectivos entornos y no se confirmaron bloqueos P0/P1. El sitio público sirve el código auditado. Los recorridos privados fueron aprobados en local con PostgreSQL real aislado y dobles de Auth/Storage; antes de una demostración autenticada en Production corresponde verificar las cuentas y datos de demostración con consentimiento y sin intervenir anuncios ajenos.

**Relacionado:** [Estado actual](ESTADO_ACTUAL.md) · [Evolución](EVOLUCION.md).
