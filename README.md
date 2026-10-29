# Sistema de publicación y consulta de vehículos usados

Proyecto académico de Programación Estructurada, Universidad Americana (UAM), Managua, Grupo 7. La fecha de cierre vigente es el **20 de noviembre de 2026**; las entregas académicas están detalladas en [ROADMAP](docs/ROADMAP.md).

## Funcionalidades actuales

PostgreSQL 17 de Supabase es la fuente de verdad. Flask consulta, valida y modifica el catálogo mediante funciones Python y SQL parametrizado, sin ORM. La interfaz conserva el diseño del inventario y usa el API de Flask.

- Catálogo público, características opcionales y galería de hasta cinco fotografías por vehículo.
- Búsqueda por texto con filtros combinables de disponibilidad, precio, año y tipo de vehículo, ordenamiento por precio o año, y fichas públicas compartibles.
- Registro, edición y disponibilidad con administración Flask, CSRF e idempotencia de altas.
- Color, placa, tipo, transmisión, combustible y equipamiento triestado: Sí, No y No especificado. La placa se entrega únicamente a la sesión administrativa.
- Preparación JPEG/PNG/WebP en navegador y validación/recodificación WebP en Python. Persistencia de objetos mediante Supabase Storage, bucket existente `vehiculos`.
- Sustitución y eliminación con recuperación durable ante fallos parciales de PostgreSQL o Storage.
- Límite de acceso persistente en PostgreSQL, compartido entre procesos y resistente a borrar cookies.

Los seis registros iniciales son ficticios. El estado realmente verificado de los servicios y las limitaciones de integración se registran en [AVANCE_02](docs/AVANCE_02.md). Chat, pagos, contacto real, cuentas de compradores/vendedores y certificación mecánica permanecen fuera del alcance confirmado. El cronograma académico vigente está en [ROADMAP](docs/ROADMAP.md).

## Instalación local

Se comprobó con Python **3.14.7**. Vercel usa Python **3.14**, indicado en `.python-version`. Las dependencias directas están fijadas en `requirements.txt`.

Windows/PowerShell, desde la raíz:

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
.\.venv\Scripts\python.exe -c "import secrets; print(secrets.token_urlsafe(48))"
.\.venv\Scripts\python.exe -c "from getpass import getpass; from werkzeug.security import generate_password_hash; print(generate_password_hash(getpass()))"
```

Linux, desde la raíz:

```bash
python3 -m venv .venv
./.venv/bin/python -m pip install -r requirements.txt
test -e .env || cp .env.example .env
./.venv/bin/python -c 'import secrets; print(secrets.token_urlsafe(48))'
./.venv/bin/python -c 'from getpass import getpass; from werkzeug.security import generate_password_hash; print(generate_password_hash(getpass()))'
```

Si `.env` ya existe, edítalo y conserva sus valores; no vuelvas a copiar la plantilla encima. Los dos últimos comandos generan la clave Flask y el hash de la contraseña administrativa. Introduce la contraseña mediante el prompt privado, nunca en argumentos de comandos ni en texto claro dentro de `.env`.

| Variable | Configuración |
| --- | --- |
| `DATABASE_URL` | Cadena PostgreSQL del proyecto correcto. Usa Transaction Pooler para Vercel, SSL y contraseña codificada para URL. |
| `SUPABASE_URL` | URL HTTPS del proyecto. La plantilla señala `rtcygltmrtulyeezaaac`. |
| `SUPABASE_SECRET_KEY` | Clave moderna `sb_secret_...`, exclusivamente de servidor. Se envía como `apikey`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Alternativa heredada JWT `service_role` cuando no hay `SUPABASE_SECRET_KEY`. Nunca usar una clave pública para escribir. |
| `FLASK_SECRET_KEY` | Clave aleatoria para firmar sesiones. Distinta por ambiente. |
| `ADMIN_PASSWORD_HASH` | Hash Werkzeug scrypt. Sin él la administración no inicia sesión. |
| `SESSION_COOKIE_SECURE` | `false` solo en HTTP local; `true` en HTTPS. Vercel la fuerza a segura. |
| `APP_READ_ONLY` | `true` bloquea login y todas las escrituras. Preview de Vercel siempre fuerza este modo. |
| `ALLOW_LOCAL_DATABASE` | `true` solo para PostgreSQL loopback aislado sin TLS. En remoto el driver siempre exige TLS. |

Las claves se configuran dentro del archivo local o las variables del ambiente, nunca en Git, HTML, JavaScript, capturas o mensajes. El navegador no se conecta directamente a PostgreSQL ni recibe claves Supabase.

Inicia desde la raíz con `.\.venv\Scripts\python.exe app.py` en Windows o `./.venv/bin/python app.py` en Linux. Abre [la aplicación local](http://127.0.0.1:5000) y detén el servidor con Ctrl+C. Usa el Python del entorno para evitar `ModuleNotFoundError: flask`. Live Server no ejecuta Flask.

## Fotografías

Primero guarda el vehículo. Después usa su botón **Fotografías** para añadir, sustituir o eliminar imágenes. El gestor funciona por separado: cancelar el formulario del vehículo no cambia sus datos y editar sus características conserva las fotos. Una carga ya confirmada en el gestor es una operación guardada, aunque después cierres el diálogo.

Cada archivo original debe ser JPEG, PNG o WebP y ocupar hasta **10.000.000 bytes**. El navegador reduce a un máximo de **1600 px** por lado, comienza en calidad **78 %** y prepara WebP de hasta **1.000.000 bytes**. Se sube un archivo por solicitud. El servidor limita la solicitud a **1.100.000 bytes**, decodifica de nuevo, rechaza animaciones y entradas corruptas, elimina metadatos y recodifica a WebP. Un cliente que omita la compresión y envíe archivos grandes será rechazado.

Las imágenes del bucket son públicas. Evita incluir placas, personas y documentos; ocultar el campo de placa no oculta una placa fotografiada. Las URLs no contienen credenciales y cada objeto usa una ruta UUID nueva, sin sobrescribir archivos anteriores.

La sustitución sube el objeto nuevo antes de confirmar la referencia y encolar el antiguo. Un fallo conserva la foto anterior o una tarea de recuperación. La limpieza reclama cada ruta bajo bloqueo, excluye referencias activas y usa una concesión de dos minutos. Las reservas de cargas incompletas caducan después de una hora.

Para mantenimiento, consulta primero la cola:

```powershell
.\.venv\Scripts\python.exe scripts/limpiar_storage.py
.\.venv\Scripts\python.exe scripts/limpiar_storage.py --apply --limite 10
```

En Linux sustituye el ejecutable por `./.venv/bin/python`. La primera orden no borra objetos. La segunda solo procesa rutas elegibles registradas en la cola; conserva fallos para reintento después de vencer la concesión. No barre el bucket ni elimina archivos por suposición. No hay cron de pago ni almacenamiento persistente en el disco de Vercel.

## Contrato HTTP

| Método y ruta | Acceso / cuerpo |
| --- | --- |
| `GET /api/vehiculos` y `GET /api/vehiculos/<id>` | Consulta pública. Devuelve vehículos con `fotografias`; omite placa sin sesión. |
| `POST /api/vehiculos` | Admin + CSRF + `Idempotency-Key` UUID; JSON `{vehiculo}`. |
| `PUT /api/vehiculos/<id>` | Admin + CSRF; JSON `{vehiculo}`. Conserva ID y fotos. |
| `PATCH /api/vehiculos/<id>/disponibilidad` | Admin + CSRF; JSON `{disponibilidad}`. |
| `POST /api/vehiculos/<id>/fotografias` | Admin + CSRF + UUID; multipart con un único campo `fotografia`. |
| `PUT /api/vehiculos/<id>/fotografias/<foto_id>` | Admin + CSRF + UUID; sustituye con multipart individual. |
| `DELETE /api/vehiculos/<id>/fotografias/<foto_id>` | Admin + CSRF; retira referencia y encola limpieza. |
| `GET /api/admin/session`, `POST /api/admin/login`, `POST /api/admin/logout` | Estado, login `{password}` y logout; mutaciones con CSRF. |

El token CSRF viaja en `X-CSRF-Token`; una alta o carga reintentada conserva su mismo UUID y contenido. Reutilizarlo con datos diferentes devuelve 409. Los formularios envían únicamente un vehículo, nunca la colección completa. Los precios permanecen en USD y PostgreSQL guarda centavos enteros. Las respuestas API y la página con CSRF llevan `Cache-Control: no-store`.

## Semillas e importación antigua

Las migraciones ya aplicadas en el proyecto autorizado no deben repetirse manualmente. El cargador `scripts/cargar_datos_demo.py` es explícito, reconoce las seis semillas exactas y solo inserta en una tabla vacía. Flask nunca las inserta en el arranque.

La interfaz no lee, escribe ni borra el antiguo `vehiculos_demo_v1`. Para rescatarlo, abre la consola del navegador en el mismo origen donde se utilizó la versión anterior y descarga su valor sin cambiarlo:

```javascript
const valor = localStorage.getItem("vehiculos_demo_v1");
if (valor === null) throw new Error("No hay inventario antiguo en este origen.");
const url = URL.createObjectURL(new Blob([valor], {type: "application/json"}));
const enlace = document.createElement("a");
enlace.href = url;
enlace.download = "vehiculos_demo_v1.json";
enlace.click();
setTimeout(() => URL.revokeObjectURL(url), 1000);
```

Guarda cada exportación fuera del repositorio, respáldala y reconcilia inventarios de distintos navegadores. Sus IDs pueden coincidir; el importador asigna IDs nuevos y omite coincidencias exactas, sin inferir equipamiento desde descripciones. Previsualiza con `python scripts/importar_localstorage.py /ruta/export.json`; solo añade `--apply` después de revisar el respaldo y el resumen. Usa el ejecutable de tu entorno. El proceso no sobrescribe anuncios ni borra el dato del navegador.

## Pruebas reproducibles

Las pruebas normales se ejecutan con `.\.venv\Scripts\python.exe -m unittest discover -s tests -v` o `./.venv/bin/python -m unittest discover -s tests -v`. Sin `TEST_DATABASE_URL`, las pruebas reales se informan como **omitidas**, no aprobadas. Los demás tests usan dobles explícitos y Pillow real.

Para integración, prepara un clúster **local aislado de PostgreSQL 17**, con rol capaz de crear bases y roles, y una base de control `grupo7_test`. Por ejemplo, con sus herramientas instaladas: `createdb -h 127.0.0.1 -U postgres grupo7_test`. Configura la contraseña local de forma privada cuando sea necesaria.

Windows:

```powershell
$env:TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:5432/grupo7_test'
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
Remove-Item Env:TEST_DATABASE_URL
```

Linux:

```bash
TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:5432/grupo7_test' ./.venv/bin/python -m unittest discover -s tests -v
```

La fixture rechaza hosts remotos y bases de control que no empiecen por `grupo7_test`. Crea bases adicionales con UUID, aplica las migraciones y elimina exclusivamente esas bases desechables. Nunca usa la base de control ni Supabase para escribir pruebas. El flujo HTTP de integración usa PostgreSQL real y **Storage simulado**; no demuestra una carga al servicio remoto.

Comprobaciones adicionales: `python -m compileall -q app.py vehiculos.py persistencia.py persistencia_fotos.py limites_login.py imagenes.py almacenamiento.py scripts tests`, `python -m pip check`, `node --check` para los tres archivos JavaScript, `node --test tests/test_interfaz_catalogo.mjs` y `git diff --check`. Node solo es una herramienta de verificación, no un requisito para ejecutar Flask.

## Preparación de Vercel

`vercel.json` declara el framework Flask y `app.py` como función con 60 segundos. `.python-version` selecciona Python 3.14. Flask referencia `/static/...` en sus plantillas; Vercel sirve esos recursos desde su CDN, así que las copias correspondientes deben permanecer versionadas en `public/static/`. Ejecuta `python scripts/preparar_vercel.py` al actualizar CSS, JavaScript o imágenes y confirma juntas las copias sincronizadas. No ignores `public/static/` ni lo excluyas en `.vercelignore`.

Configura las variables por ambiente en Vercel; nunca las escribas en `vercel.json`. Para que el catálogo de Preview lea datos y genere sesiones, asigna `DATABASE_URL`, `FLASK_SECRET_KEY` y `SUPABASE_URL` al ambiente **Preview**. `DATABASE_URL` debe usar TLS; usa un rol de solo lectura o un proyecto de datos separado cuando esté disponible. Los enlaces públicos de fotos solo necesitan `SUPABASE_URL`; no copies claves de escritura ni el hash administrativo de Production a Preview.

**Preview siempre fuerza modo de solo lectura**, aunque `APP_READ_ONLY=false`: `/api/admin/session` informa `solo_lectura: true`, la interfaz oculta «Administrar» y `/api/admin/login` responde 503. Es deliberado para evitar escrituras desde una Preview contra datos compartidos. Para habilitar administración en Production, asigna `ADMIN_PASSWORD_HASH`, `FLASK_SECRET_KEY`, `DATABASE_URL`, `SUPABASE_URL` y una clave de servidor `SUPABASE_SECRET_KEY` (preferida) o `SUPABASE_SERVICE_ROLE_KEY` (alternativa heredada); configura `APP_READ_ONLY=false` y conserva cookies HTTPS seguras. No habilites escrituras de Preview sin un entorno de datos/Storage separado y una revisión explícita de la protección.

Antes de Production: comprobar credenciales y conectividad reales; verificar Storage sin usar los seis anuncios como pruebas; revisar las fotos y el acceso del equipo; aprobar el despliegue definitivo. Esta tarea no autoriza promoción a Production ni cambios a las variables de entorno.

## Documentación

[Arquitectura](docs/ARQUITECTURA.md), [decisiones](docs/DECISIONES.md), [roadmap](docs/ROADMAP.md), [segundo avance](docs/AVANCE_02.md), [tercer avance](docs/AVANCE_03.md) e [instrucciones de mantenimiento](AGENTS.md).
