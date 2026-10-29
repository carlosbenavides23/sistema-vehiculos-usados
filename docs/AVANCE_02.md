# Segundo avance: registro y edición de vehículos

## Objetivo

Permitir registrar, listar, seleccionar y editar vehículos, cambiar disponibilidad y conservar cambios al recargar el mismo navegador. Prototipo académico del Grupo 7, UAM Managua, con datos ficticios.

## Implementación y escenario de demostración

El backend Python valida campos y estado, asigna IDs y devuelve colecciones nuevas. JavaScript conserva el estado versionado, solicita operaciones y presenta resultados. Se incluye un formulario compartido de registro/edición, cancelación, errores por campo, listado y restablecimiento confirmado.

Escenario: iniciar Flask con el README, abrir la página, comprobar seis registros, registrar un vehículo, editarlo, marcarlo vendido y recargar. Probar una edición inválida y cancelarla; los datos guardados deben permanecer. Restablecer la demostración solo después de aceptar la confirmación.

## Verificaciones iniciales

Verificaciones ejecutadas el **22 de octubre de 2026**, en Windows/PowerShell, Python **3.14.7** del entorno `.venv`, Flask **3.1.3** y navegador integrado de Codex.

### Comandos ejecutados

Desde la raíz del repositorio:

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe app.py
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
node --check static/js/interfaz.js
node --check static/js/datos-demo.js
.\.venv\Scripts\python.exe -m pip check
```

El primer comando creó el entorno; el segundo instaló Flask y dependencias. El tercero inició el servidor indicado por el README en `127.0.0.1:5000`, con respuesta HTTP 200 y carga de recursos locales. `unittest` ejecutó **34 pruebas, todas aprobadas** (última ejecución: **0.210 segundos**, `OK`). Los dos comandos `node --check` comprobaron sintaxis JavaScript, ambos con salida correcta/código 0. `pip check` devolvió **No broken requirements found**. Node se utilizó únicamente como herramienta de comprobación, no es requisito para ejecutar el proyecto.

Las pruebas Python cubren entradas y formatos inválidos, booleanos y números no finitos, precisión del dinero, año y kilometraje, IDs únicos y límite seguro, edición inexistente, conservación del identificador, ausencia de mutaciones ante éxito/error, disponibilidad, aislamiento entre solicitudes, límite de 500 registros, JSON y estados inválidos, y respuestas HTTP 400/404/405/413/422.

### Flujo real comprobado en navegador

| Comprobación | Resultado observado |
| --- | --- |
| Primera apertura | Seis vehículos: cinco disponibles y uno vendido |
| Registro inválido | Campos vacíos y marca con espacios devolvieron errores asociados; se conservaron los demás valores del formulario |
| Registro válido | Toyota Yaris QA agregado como ID 7, precio USD 12,345.67; listado de siete |
| Edición | Mismo ID 7 con modelo Yaris Editado y precio USD 12,999.99; no se creó otro registro |
| Cancelar edición | El cambio de modelo descartado no sustituyó el modelo guardado |
| Disponibilidad y recarga | ID 7 pasó a vendido; recarga mantuvo siete vehículos y dos vendidos, sin duplicados |
| Fallo del backend | Con el servidor detenido, guardar mostró error comprensible y conservó los campos; al reiniciar y recargar siguió el modelo anterior |
| Edición inválida y estado persistido | Modelo con espacios rechazado; comparación del texto completo almacenado antes/después resultó idéntica |
| JSON corrupto | Texto `{datos-dañados` bloqueó edición; se leyó después exactamente el mismo texto, sin reemplazo automático |
| Versión incompatible | `{version:2, vehiculos:[]}` bloqueó edición y quedó sin cambios |
| Colección vacía válida | Cero registros y acción para crear; tras recarga siguió vacía y no volvió a cargar la semilla |
| Pantalla de 375 × 812 | Registro de Mazda 2 móvil completado desde cero; ID 1 y USD 11,000.10. Sin desbordamiento: ancho del documento 360 y contenido 360, descontando la barra vertical |
| Restablecimiento cancelado | Cancelar conservó el Mazda; Escape conservó el texto corrupto en otra prueba; foco inicial en Cancelar |
| Restablecimiento confirmado | Recuperó los seis registros, tanto desde una colección modificada como desde datos corruptos; recarga mantuvo seis |
| Presentación | Revisados listado de escritorio, formulario móvil, errores y confirmación; etiquetas visibles y foco en los diálogos |

Para introducir estados corruptos, incompatibles y vacíos se usó un **arnés temporal de pruebas fuera del repositorio**, con controles visibles para leer/escribir únicamente la clave de demostración. No forma parte de las rutas ni del producto entregado. El servidor normal se inició directamente mediante el comando del README. Los procesos temporales se detuvieron al terminar.

La primera alerta nativa de restablecimiento bloqueó la herramienta del navegador. Se sustituyó por un diálogo HTML accesible, que después se comprobó mediante Cancelar, Escape y confirmación. Durante esa integración fue necesario reiniciar Flask para cargar las plantillas actualizadas, pues la depuración está desactivada. No quedan pruebas de esa alerta nativa como evidencia del flujo final.

Capturas locales del resultado, actualizadas después de las correcciones finales: [inventario de escritorio](capturas/inventario-escritorio.png) y [formulario móvil](capturas/formulario-movil.png).

La revisión estática comprobó reglas en Python, ausencia de base de datos y servicios remotos y uso de imágenes locales. No se forzó una cuota de almacenamiento agotada ni se probó en otros navegadores; su manejo se revisó en el código. No se afirma certificación de accesibilidad ni soporte probado de todos los navegadores.

### Integración y revisión

Se utilizaron tres subagentes con archivos asignados: backend/pruebas, interfaz y revisión independiente de solo lectura. El agente principal definió el contrato, integró los resultados, escribió documentación y ejecutó las comprobaciones finales. La revisión independiente no reportó hallazgos accionables. Se inicializó Git en `main`, sin archivos previos ni remoto. Se revisaron los archivos nuevos como diff contra vacío y el estado final; no se hicieron commits, push, merge ni despliegue.

## Correcciones finales y preparación de la entrega

### Cambios aplicados

- `static/css/estilos.css`: se retiró el límite de dos líneas de las descripciones. Tarjetas con altura adaptable, texto que puede partirse y acciones al pie. Descripciones de 14 px, etiquetas de 14 px, campos de 16 px, textos auxiliares de al menos 12 px y controles de al menos 44 px. El formulario pasa a una columna en móvil; sus botones ya no se superponen al contenido.
- `README.md`: instalación desde la raíz con rutas relativas, creación del entorno e instalación de dependencias en Windows y Linux. Se explica el ejecutable de `.venv`, la ejecución desde terminal de VS Code y la causa de un Flask ausente al utilizar otro Python.
- `AGENTS.md`, `ARQUITECTURA.md` y `DECISIONES.md`: instrucciones portables, presentación y proceso de empaquetado documentados. `ROADMAP.md` revisado: continúa vigente, sin funciones ni fechas nuevas.
- Las dos capturas documentales se actualizaron. `entregables/` se excluye de Git para separar los paquetes generados del código.

No se modificaron `app.py`, `vehiculos.py`, las rutas, el JavaScript, los datos ficticios, el HTML, los requisitos ni las pruebas. La lógica principal sigue en funciones Python; Flask no conserva una colección global y la persistencia exclusiva sigue en `localStorage`.

### Pruebas posteriores a las correcciones

Ejecutadas el **22 de octubre de 2026**, en el mismo entorno Windows: **34 pruebas Python aprobadas, 0 fallidas** (`unittest`, 0.231 segundos). Los dos archivos JavaScript pasaron `node --check`. Estas comprobaciones del backend y de sintaxis se distinguen del flujo real de navegador siguiente.

En un origen local de prueba independiente se comprobó:

| Escenario | Evidencia observada |
| --- | --- |
| Primera apertura y recarga | Seis vehículos iniciales; recarga mantuvo seis |
| Registro y doble envío | Doble clic en Guardar, con respuesta demorada 1.5 s: controles deshabilitados durante la solicitud y un único ID 7; total siete |
| Edición y cancelación | Modelo actualizado sin cambiar ID 7; una edición posterior cancelada conservó el modelo guardado |
| Disponibilidad y persistencia | Alternó disponible/vendido/disponible; el estado vendido sobrevivió a una recarga |
| Entrada inválida | Marca con espacios devolvió error asociado y conservó el resto del formulario; texto completo de almacenamiento idéntico antes/después |
| Fallo del backend | Respuesta HTTP 503 simulada después de cargar el inventario: error visible, texto escrito conservado y almacenamiento idéntico, sin anunciar guardado |
| Almacenamiento corrupto | Texto `{datos-corruptos` quedó intacto; edición bloqueada y mensaje de recuperación |
| Restablecimiento | Cancelar conservó siete registros; confirmar desde el estado corrupto recuperó seis, conservados al recargar |
| Descripción extensa | 1,000 caracteres, incluidos 230 consecutivos sin espacios y marcador final; todo el texto visible y altura de contenido igual a la del elemento en las cinco anchuras |

La simulación de demora y HTTP 503, y los controles para leer/escribir la clave ficticia, pertenecen a un arnés temporal fuera del repositorio. No se incluyen sus rutas, archivos, datos de prueba ni logs en el producto ni en el ZIP.

### Comprobación responsive

Navegador integrado, altura de viewport 900 px. El ancho útil descuenta la barra vertical. Se revisaron visualmente formularios y distribución de tarjetas, se midió el documento y el diálogo, y se comprobó Tab de Marca a Modelo, Escape o Cancelar y acceso a botones.

| Viewport | Ancho útil / contenido del documento | Ancho / contenido del formulario | Columnas de tarjetas | Descripción de 1,000 caracteres: altura visible / contenido |
| --- | --- | --- | --- | --- |
| 320 px | 305 / 305 px | 267 / 267 px | 1 | 907 / 907 px |
| 375 px | 360 / 360 px | 322 / 322 px | 1 | 760 / 760 px |
| 768 px | 753 / 753 px | 600 / 600 px | 2 | 662 / 662 px |
| 1024 px | 1009 / 1009 px | 600 / 600 px | 3 | 809 / 809 px |
| 1440 px | 1425 / 1425 px | 600 / 600 px | 3 | 613 / 613 px |

No se observó desbordamiento horizontal. En todas las anchuras las etiquetas midieron 14 px, los campos 16 px y la ayuda 12 px; botones de tarjetas de al menos 44 px (49 px en móvil). Las descripciones completas aumentan la altura de las tarjetas de manera esperada.

### Paquete

Nombre: `Grupo7_Sistema_Vehiculos_Usados_Avance02.zip`, con una sola carpeta raíz `Grupo7_Sistema_Vehiculos_Usados_Avance02/`. Incluye código, recursos, dependencias, pruebas, documentación y capturas documentales. Excluye Git, entornos, cachés, archivos temporales, logs, credenciales, arneses y paquetes anteriores sin borrarlos del directorio de trabajo.

La inspección del ZIP, la instalación y pruebas desde una extracción limpia, la comprobación de Flask/navegador, el tamaño, el número de archivos y el SHA-256 definitivo se registran en el informe que acompaña al archivo en `entregables/`. El hash se calcula después de cerrar el ZIP.

En esta corrección se delegó exclusivamente el CSS a un subagente. El agente principal revisó los cambios, preparó documentación y paquete y realizó las comprobaciones de integración.

## Limitaciones registradas al cierre del segundo avance (22 de octubre de 2026)

La persistencia está ligada al navegador y al origen; no se comparte entre dispositivos ni vendedores/compradores. Borrar los datos del sitio elimina la colección. No hay resolución de concurrencia entre pestañas. El backend no ofrece autenticación ni persistencia definitiva. Los datos ficticios no acreditan condiciones técnicas de los vehículos.

Fuera de alcance: búsqueda avanzada, fichas ampliadas, contacto real, cuentas, pagos, chat, documentos, integraciones y certificación. La validación técnica del vehículo y el significado de “poner números” requieren aclaración. USD y los límites de longitud son decisiones reversibles documentadas. Fecha límite total: **30 de noviembre de 2026**; presentaciones restantes pendientes de confirmación.

## Auditoría del repositorio y preparación futura

Revisión realizada el **29 de octubre de 2026** en la rama `chore/repository-hygiene`, creada desde `main` después de verificar que no existiera. El estado inicial estaba limpio. Los 19 archivos rastreados eran código, recursos usados por la aplicación, pruebas y documentación; las capturas son evidencia documental necesaria. No se retiró ningún archivo del índice. `.venv/`, cachés de Python y `entregables/` estaban ignorados y se conservaron localmente.

Se amplió `.gitignore` para incluir cachés de análisis, entornos virtuales, credenciales y configuración privada local, archivos de persistencia local, logs, temporales, paquetes ZIP, artefactos Python y `.vercel/`. Se añadió `.env.example`: declara que la aplicación actual no requiere variables; las referencias a PostgreSQL/Supabase, Storage y una posible clave de Flask están comentadas como planificación futura, sin valores ni dependencias de código. No existen carpetas ni implementaciones vacías para esos servicios.

Se inspeccionó el contenido de los archivos rastreados y el historial local disponible buscando patrones comunes de secretos y rutas personales. No se encontraron coincidencias. Esta comprobación estática no garantiza detectar todos los secretos o datos personales, y no sustituye herramientas especializadas ni una auditoría de permisos de GitHub. No se reescribió el historial. El proyecto utiliza Git y está alojado en GitHub; esta tarea no publica cambios.

Las observaciones del profesor sobre características detalladas y fotografías reales seguían pendientes. Al realizar la auditoría de higiene del 29 de octubre, PostgreSQL, Supabase (incluido Storage) y Vercel aún no estaban implementados/configurados. La Fase 1 posterior actualiza el estado de persistencia y se registra abajo; Storage y Vercel permanecen pendientes. La preparación de higiene no modificó reglas, rutas, dependencias ni funcionalidades del segundo avance.

## Fase 1: PostgreSQL con Supabase (29 de octubre de 2026)

### Implementación

- PostgreSQL 17 en el proyecto Supabase autorizado `rtcygltmrtulyeezaaac` quedó como fuente de verdad. Flask usa consultas parametrizadas mediante psycopg; no conserva una colección global de vehículos.
- Se aplicaron las migraciones `20261029204809_create_vehicles_schema` y `20261029205549_seed_demo_vehicles`. La primera crea `public.vehiculos` y `public.vehiculo_fotografias`, sus restricciones e identidades y habilita RLS. La segunda inserta los seis registros ficticios únicamente si la tabla está vacía. PostgreSQL asignó los IDs.
- La consulta remota confirmó seis vehículos, seis IDs únicos, cinco disponibles, uno vendido y valores NULL en campos opcionales. La tabla de fotografías tiene cero filas. No se crearon buckets ni se modificó Storage.
- RLS está habilitado, no hay políticas en las dos tablas y `anon`/`authenticated` no tienen privilegios directos de lectura ni escritura. El acceso de la aplicación pasa por Flask. El asesor de seguridad reporta `rls_enabled_no_policy` como INFO en ambas tablas; es el cierre esperado para este modelo. El asesor de rendimiento no reportó avisos.
- Flask expone las consultas públicas, alta, consulta por ID, edición y cambio de disponibilidad. Las escrituras requieren sesión administrativa y CSRF. Las respuestas públicas omiten la placa. La interfaz consulta Flask; ya no usa `localStorage` operacionalmente ni borra el dato antiguo.
- La importación del inventario antiguo tiene previsualización por defecto y escritura solo mediante `--apply`. No se importaron exportaciones de navegadores; esos datos siguen intactos. La carga local de semillas es explícita y no se ejecuta en el arranque.
- `.env.example`, README e instrucciones describen `DATABASE_URL`, `FLASK_SECRET_KEY`, `ADMIN_PASSWORD_HASH`, ejecución local y limitaciones. No se incluyeron credenciales reales.

### Pruebas y límites de verificación

Se ejecutó `python -m unittest discover -s tests -v`: **25 pruebas aprobadas**, incluidas pruebas de validación, contrato API y persistencia con cursor falso. No son pruebas de integración con PostgreSQL. No había `DATABASE_URL` configurada en el entorno, así que no se conectó la aplicación Flask al proyecto remoto ni se verificaron transacciones desde el driver. Tampoco se ejecutó un flujo de extremo a extremo en navegador. La verificación remota cubrió el esquema, los datos, los privilegios y los asesores mediante Supabase MCP.

`node --check` pasó para `static/js/interfaz.js` y `static/js/datos-demo.js`; `pip check` no encontró requisitos rotos; `git diff --check` no reportó problemas. No se hizo commit, push, merge ni despliegue. Rama activa: `feature/supabase-migration`; los cambios de esta tarea quedan locales.

### Seguridad provisional y trabajo futuro

La sesión usa cookie Flask firmada, HttpOnly, SameSite=Lax y Secure configurable para HTTPS; el hash de acceso se configura en entorno. Las contraseñas de más de 1024 caracteres se rechazan antes de verificar el hash. El límite provisional de intentos vive en la cookie y puede reiniciarse al borrarla; no constituye rate limiting robusto. Antes de exposición prolongada se necesita limitación persistente/global o autenticación con cuentas.

No se implementaron fotos, procesamiento, políticas de Storage, Vercel, chat, pagos ni contacto real. No se desplegó la aplicación. Antes de cerrar la validación integral se debe probar el backend contra una base de pruebas aislada con credenciales locales, revisar el flujo en navegador y, si se decide rescatar datos antiguos, exportarlos y conciliarlos manualmente.

## Implementación integral — posterior a la Fase 1, 29 de octubre de 2026

Esta sección sustituye el estado vigente de la Fase 1; las secciones anteriores conservan su evidencia histórica. Se trabajó en `feature/supabase-migration`, partiendo de `bbf5fd5` con los cambios locales de la Fase 1 sin confirmar. Se conservaron esos cambios y se completaron las características, fotografías y seguridad solicitadas. No se modificó main ni se publicó en Production.

### Coordinación y revisión

Se utilizaron realmente tres subagentes: `database_integral` implementó persistencia, coordinación SQL, limitación de acceso y pruebas PostgreSQL; `backend_integral` implementó rutas, seguridad, Pillow, Storage y sus pruebas; `frontend_integral` implementó formulario, compresión, galería, gestor y CSS. Sus archivos no se solaparon. El coordinador integró, añadió pruebas HTTP con PostgreSQL real, preparó Vercel/documentación, ejecutó navegador y revisó/aplicó el SQL remoto.

El subagente de frontend efectuó después una revisión independiente de solo lectura. Detectó una carrera de limpieza al cruzar el vencimiento de una reserva y una comprobación insuficiente por cadenas del destino Preview. Se corrigió la primera con reclamación atómica, bloqueo en orden consistente, cancelación y concesión; dos regresiones reales prueban ambos órdenes de concurrencia. Preview quedó siempre de consulta, sin excepción configurable de escritura. La revisión adicional del adaptador corrigió el cierre de respuestas HTTP de error y verificó que un 409 de Storage no confirme metadatos antes de comprobar que el objeto existe y contiene los mismos bytes.

### Cambios por archivo

| Archivo o grupo | Cambio aportado |
| --- | --- |
| `app.py` | API por vehículo/foto, sesión/CSRF, autorización, alta UUID, límites de solicitud, acceso persistente, errores seguros, no-store y Preview de consulta. |
| `vehiculos.py` | Campos opcionales/triestado y compatibilidad de importaciones antiguas; valida mediante funciones. |
| `persistencia.py` | SQL parametrizado, TLS, IDENTITY, límite 500, idempotencia y cargadores sin sobrescritura. |
| `persistencia_fotos.py` | Reservas, máximo cinco, sustitución/rollback y cola durable reclamada antes de borrar. |
| `limites_login.py` | Cinco intentos por diez minutos compartidos en PostgreSQL; limpieza acotada de ventanas antiguas. |
| `imagenes.py` | Pillow real: JPEG/PNG/WebP, límites, orientación, rechazo de animación/corrupción y WebP sin metadatos. |
| `almacenamiento.py` | REST del bucket vehiculos, claves solo de servidor, sin upsert, verificación de reintentos, errores seguros y limpieza recuperable. |
| `templates/index.html`, `static/js/interfaz.js`, `static/js/fotografias.js`, `static/css/estilos.css` | Administración, opcionales, preparación de imágenes, vista previa, galería y gestor responsive con confirmaciones. |
| `supabase/migrations/` | Dos migraciones de la Fase 1 conservadas y tercera aditiva de administración/fotos/idempotencia. |
| `scripts/cargar_datos_demo.py`, `scripts/importar_localstorage.py` | Carga/importación deliberada, previsualización y prevención de duplicados de la Fase 1. |
| `scripts/limpiar_storage.py` | Mantenimiento con previsualización por defecto y --apply para rutas elegibles. |
| `scripts/preparar_vercel.py`, `vercel.json`, `.python-version`, `.vercelignore` | Entrada Flask, Python 3.14, función de 60 s, recursos CDN y exclusión de secretos/artefactos. |
| `requirements.txt`, `.env.example`, `.gitignore` | Dependencias fijadas con Pillow 13, variables sin secretos y exclusión de salida generada. |
| Ocho archivos `tests/test_*.py` | Validación, API, adaptador, imágenes, recuperación, idempotencia y PostgreSQL real aislado. |
| README, AGENTS, arquitectura, decisiones, roadmap y este avance | Instrucciones Windows/Linux, contratos, operación, límites y evidencia actualizados. |

### PostgreSQL remoto

Se volvió a comprobar la identidad `rtcygltmrtulyeezaaac`, PostgreSQL 17.11, región us-west-2. Existían las dos tablas de aplicación y las dos migraciones esperadas. No se duplicaron semillas ni se crearon proyectos/buckets.

Se aplicó por Supabase MCP la migración **`20261029213538_admin_fotos_idempotencia`**. Añade `admin_login_intentos`, `solicitudes_idempotentes`, `fotografia_operaciones` y `storage_limpieza`, claves, restricciones e índices. Las seis tablas tienen RLS y los privilegios directos de PUBLIC/anon/authenticated están revocados. No se habilitaron políticas públicas de escritura.

Antes y después hubo seis vehículos, cero fotografías y cero objetos en el bucket. La huella de todos los campos de los vehículos se mantuvo exactamente en `f270d49156da72c62e0083c0219f719d`. El bucket existente sigue público, solo WebP, límite de 1.048.576 bytes; la aplicación impone un límite menor de 1.000.000 bytes. No se enviaron imágenes de prueba al remoto.

Asesores después de DDL: seis avisos **INFO** [RLS Enabled No Policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), deliberados por el acceso exclusivo mediante Flask, y cuatro **INFO** [Unused Index](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index) en índices recién creados. No hubo avisos WARNING/ERROR. Se conservaron los índices de claves foráneas, vencimiento y limpieza para sus consultas previstas.

### Pruebas ejecutadas

Windows, Python 3.14.7, Flask 3.1.3, psycopg 3.3.6, python-dotenv 1.2.4 y Pillow 13.0.0. Se obtuvo PostgreSQL portable 17.11 de la fuente oficial EDB y se inició un clúster temporal propio, solo loopback, puerto 15439. No se instaló un servicio permanente ni se utilizó la base remota para escrituras de prueba.

Comando principal: `TEST_DATABASE_URL` apuntando a `postgresql://postgres@127.0.0.1:15439/grupo7_test`, seguido de `python -m unittest discover -s tests -v` con el ejecutable del entorno. **70 pruebas, 70 aprobadas, ninguna omitida, 19.448 s.**

| Tipo | Cantidad | Alcance ejecutado |
| --- | --- | --- |
| PostgreSQL real | 16 | Migraciones/RLS, restricciones, CRUD entre conexiones, seed/importación, IDs concurrentes, máximo 500, idempotencia, cinco fotos, rollback, limpieza y limitación compartida. |
| Flask + PostgreSQL real + Storage doble | 4 | Flujo HTTP, semillas intactas, autorización/CSRF, idempotencia, equipamiento, fotos, fallos y contador persistente pese a nuevas cookies. |
| Unitarias | 50 | Validación, contrato HTTP, dobles de persistencia/Storage, TLS y decodificación/recodificación real de Pillow. |

La suite creó y eliminó únicamente bases locales nuevas con UUID. Los 20 escenarios con PostgreSQL no equivalen a cargas contra Supabase Storage. Los fallos del proveedor se inyectaron explícitamente. Después se corrigió el cierre del objeto HTTPError y se ejecutaron de nuevo las siete pruebas del adaptador con ResourceWarning tratado como error y recolección de basura: 7/7, sin advertencias.

`compileall`, `pip check`, sintaxis de los tres JavaScript y `git diff --check` pasaron. El script de build copió cinco recursos a public/static y se compararon sus hashes con static: idénticos. El JSON se contrastó con las propiedades del esquema oficial de Vercel. Esto valida la preparación local; no constituye un build o despliegue ejecutado por Vercel.

### Navegador real

Se inició un arnés temporal fuera del repositorio en 127.0.0.1:5057, con PostgreSQL real propio y Storage doble en memoria. El arnés no forma parte del producto. Se probaron formularios, archivos y controles reales con el navegador integrado; no se escribieron registros remotos.

| Escenario | Resultado observado |
| --- | --- |
| Consulta pública | Seis semillas iniciales y acciones de edición ocultas. |
| Login y entrada inválida | Acceso correcto; marca de espacios rechazada, otros campos conservados. |
| Doble clic en registro | Un único vehículo nuevo ID 7; total siete. |
| Opcionales | Color/placa/tipo/transmisión/combustible guardados; Sí/No/No especificado visibles de forma coherente. Placa ausente de la tarjeta pública. |
| Compresión | JPEG de 2400×1800 preparado por el navegador como WebP de 1600×1200, aproximadamente 817 KB; vista previa antes de guardar. |
| Doble clic en carga | Una sola fotografía guardada. |
| Sustitución | Descartar selección conservó la foto; confirmar guardó nueva imagen manteniendo una sola referencia. |
| Eliminación | Cancelar conservó la foto; confirmar la retiró. |
| Imagen corrupta | Mensaje comprensible, sin alta; luego se pudo cargar una imagen válida. |
| Cancelar edición | Modelo anterior conservado. |
| Guardar y disponibilidad | Mismo ID 7, fotos conservadas, vendido persistente al recargar. |
| Galería pública | Dos fotografías y navegación 1/2→2/2; solo botones de galería visibles después de logout. |
| Responsive | Anchos 320,375,768,1024,1440; sin desbordamiento horizontal. Formulario y gestor scrollables; a320 px el diálogo de fotos midió282 px. |
| Consola | Sin errores ni advertencias observados en el flujo final. |

Las imágenes eran fixtures sintéticas para probar archivos; no fotografías reales de anuncios ni evidencia de características mecánicas. Capturas de formulario móvil, gestor móvil y catálogo se guardaron en `entregables/integral/`, ignoradas por Git.

### Credenciales, Vercel y límites pendientes

Vercel MCP confirmó cuenta Hobby activa, sin proyectos accesibles en la inspección. Se verificó en su documentación el soporte de app.py:app, Python, CDN public/ y límites de funciones. Se preparó la configuración, pero no se creó Preview ni se ejecutó Production. No se configuraron servicios de pago ni se hizo push o merge.

Al cerrar la implementación, DATABASE_URL, las claves de Storage y ADMIN_PASSWORD_HASH aún no estaban configurados. Se dejó `.env` local ignorado con plantilla y una clave Flask aleatoria; no se mostraron sus valores. Por ello no se afirma conexión Flask→Supabase, carga/borrado al Storage remoto ni URL Preview funcional. La lectura y el DDL remotos descritos se realizaron por MCP.

Para publicar falta exactamente: completar secretos privados; comprobar conexión real y fotografías con datos autorizados sin modificar las seis semillas; revisar el acceso administrativo compartido y la operación de limpieza; crear/verificar Preview de consulta si corresponde; aprobar Production con variables propias y HTTPS. Preview siempre de solo lectura evita usar producción como ambiente de pruebas de escritura. La exposición prevista termina el 27 de noviembre y su retirada no está automatizada.

Al terminar se cerró el arnés, se eliminó su base UUID mediante la fixture y se detuvo el PostgreSQL portátil. No quedan servidores de prueba de esta tarea en ejecución. Las capturas y herramientas temporales permanecen fuera del índice.

Se autoriza y prepara un commit local del conjunto verificado; el hash definitivo se informa en la entrega. El repositorio conserva `.env`, cachés, recursos CDN y evidencia de prueba fuera del índice. No se publica el commit sin nueva autorización.
