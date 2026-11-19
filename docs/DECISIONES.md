# Decisiones técnicas y de alcance — estado al 18-11-2026

**Base documental:** `main` V7.20.5, auditado en V7.21. Las decisiones aquí descritas son las **vigentes**; las superadas se registran al final para conservar la evolución. Véanse [Estado actual](ESTADO_ACTUAL.md), [Arquitectura](ARQUITECTURA.md) y [Evolución](EVOLUCION.md).

## 1. Decisiones vigentes

| Decisión | Motivo y consecuencia |
| --- | --- |
| **Prototipo académico, no producto comercial** | Se pretende demostrar registro, consulta, gestión y contacto entre roles; no pagos ni certificación o moderación propia de un marketplace comercial. |
| **Flask + Jinja + HTML/CSS/JS nativos** | Alcance limitado, sin necesidad de framework frontend, ORM o despliegue de servicios adicionales. |
| **PostgreSQL 17 como fuente de verdad** | Inventario compartido y reglas verificables en el servidor. La antigua persistencia de `localStorage` quedó atrás. |
| **psycopg + SQL parametrizado** | Control explícito de validación, acceso a datos, concurrencia y transacciones. |
| **Supabase Auth para cuentas y roles comprador/vendedor** | Identidades individuales y verificables; el rol se vincula a la cuenta y no se confía en metadatos editables como autorización. |
| **Propiedad individual de publicaciones** | Un vendedor solo puede administrar vehículos/fotografías y conversaciones de su ámbito; la propiedad se verifica del lado servidor. |
| **Nombre visible fijo al registrarse (V7.10)** | Se eliminó su edición posterior para reducir complejidad y mantener identidad estable durante la demostración. |
| **Catálogo y perfiles públicos sin cuenta** | La consulta de anuncios es la función central; la autenticación se pide al realizar una acción privada como contactar. |
| **Chat privado comprador/vendedor** | Un contacto conserva el vehículo y los participantes, con historial persistido y reintentos idempotentes. |
| **Administrador global y chat anónimo retirados (V7.9)** | Unificar permisos en cuentas individuales y conservar historial antiguo de forma autorizada y solo lectura. |
| **Precio en USD/centavos enteros y IDs generados por PostgreSQL** | Evitar errores de coma flotante e IDs elegidos por el navegador. |
| **Características opcionales y booleanos triestado** | Lo no informado no equivale a «No»; los campos desconocidos no se inventan desde descripciones. |
| **Placa privada, fotos públicas revisadas** | El campo matrícula no se entrega en consultas públicas; si la matrícula aparece en una imagen, debe ocultarse manualmente. |
| **Máximo de cinco fotografías y WebP recodificado** | Compatibilidad con límites de tamaño, reducción de almacenamiento y rechazo de archivos corruptos o metadatos innecesarios. |
| **Coordinación durable con Storage** | Reservar, confirmar y limpiar sin borrar prematuramente imágenes vigentes; una falla parcial debe ser recuperable. |
| **Idempotencia de altas, fotos y mensajes** | Evitar duplicados ante doble clic, reintentos y errores de respuesta. |
| **Sesiones, CSRF y permisos verificados en servidor** | No confiar en botones ocultos ni en identificadores del cliente. |
| **RLS y privilegios públicos cerrados** | El acceso de datos está mediado por Flask y credenciales privadas del servidor. |
| **Preview siempre en modo de consulta** | Reducir el riesgo de una rama temporal escribiendo sobre datos remotos. |
| **Recursos estáticos duplicados mediante sincronización controlada** | Vercel requiere los assets bajo `public/static/`; deben coincidir con `static/`. |
| **Congelación funcional tras la auditoría** | No añadir funciones ni refactorizar sin un defecto demostrado que lo justifique antes de presentar. |

## 2. Decisiones sustituidas durante el desarrollo

| Antes | Sustitución / fecha lógica |
| --- | --- |
| Datos propios de cada navegador en `localStorage` | PostgreSQL compartido con API Flask (primera migración del proyecto). |
| Administración por contraseña compartida | Roles individuales de vendedor; login global retirado en V7.9. |
| Mensajería de visitantes anónimos | Conversaciones privadas de compradores autenticados; escritura anónima retirada en V7.9, historial anterior de solo lectura. |
| Nombre visible editable en V7.6 | Nombre fijo desde el registro a partir de V7.10 (PR #29). |
| Fichas con imágenes relativamente pequeñas y contenido repetido | Ficha V7.19–V7.20 con galería protagonista y panel comercial diferenciado. |
| Regreso genérico después de acciones y login | Navegación contextual y transiciones de sesión V7.13–V7.20.4. |

Las migraciones y notas históricas se mantienen para rastreabilidad, **no** como autorización para reactivar rutas, modificar datos remotos ni volver a ejecutar DDL.

## 3. Criterio de aceptación y evidencia

La auditoría V7.21 confirmó la navegación pública de Production sobre `336bf7f` y, en local, los recorridos autenticados con PostgreSQL 17 aislado y dobles de Auth/Storage. Pasaron 28 pruebas localizadas más 8 con PostgreSQL. No se confirmaron defectos P0/P1 ni P2/P3 que afectaran los recorridos evaluados.

**Decisión de cierre:** `APTO CON OBSERVACIONES`. Es suficiente para **detener la expansión funcional**, no para afirmar que está todo validado en Production o que la seguridad es equivalente a una plataforma comercial.

## 4. Pendientes reales de entrega

1. **Validación remota autorizada:** comprobar con identidades y publicaciones ficticias que login, publicación, fotografías y chat funcionan con Supabase Auth, PostgreSQL y Storage reales; registrar la evidencia sin alterar anuncios ajenos.
2. **Datos de demostración:** preparar contenido ficticio adecuado y revisar capacidad de almacenamiento; el número de anuncios de una futura demostración es una meta, no un volumen actualmente comprobado.
3. **Presentación:** ensayar visitante, comprador y vendedor, preparar acceso a cuentas y explicación de arquitectura y límites.
4. **Operación:** antes de cualquier limpieza de Storage o copia temporal PostgreSQL, verificar alcance y respaldos; ninguna limpieza se autoriza implícitamente.
5. **Plazos:** confirmar con el equipo/docente las fechas académicas y el fin de publicación descritos en [ROADMAP](ROADMAP.md).

## 5. Fuera del alcance y política de cambios

No se requiere implementar pagos, financiación, verificación mecánica, reputación, denuncias, motores de recomendación, seguimiento social, monetización, microservicios ni migración a otro lenguaje para concluir el curso.

Solo deben plantearse cambios de aplicación por defectos reproducibles que bloqueen un recorrido principal, afecten autorización, integridad, privacidad o estabilidad de la presentación. Las mejoras estéticas u opciones de producto se registran como posibles ideas, no como tareas pendientes del prototipo.

**Toda nueva operación remota** (migración, despliegue, limpieza, alta masiva, cambio de permisos o configuración) requiere autorización específica y comprobaciones de respaldo. No confundir una Preview con aprobación para Production.
