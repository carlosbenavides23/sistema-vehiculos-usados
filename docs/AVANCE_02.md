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

## Limitaciones y pendientes

La persistencia está ligada al navegador y al origen; no se comparte entre dispositivos ni vendedores/compradores. Borrar los datos del sitio elimina la colección. No hay resolución de concurrencia entre pestañas. El backend no ofrece autenticación ni persistencia definitiva. Los datos ficticios no acreditan condiciones técnicas de los vehículos.

Fuera de alcance: búsqueda avanzada, fichas ampliadas, contacto real, cuentas, pagos, chat, documentos, integraciones y certificación. La validación técnica del vehículo y el significado de “poner números” requieren aclaración. USD y los límites de longitud son decisiones reversibles documentadas. Fecha límite total: **30 de noviembre de 2026**; presentaciones restantes pendientes de confirmación.

## Auditoría del repositorio y preparación futura

Revisión realizada el **29 de octubre de 2026** en la rama `chore/repository-hygiene`, creada desde `main` después de verificar que no existiera. El estado inicial estaba limpio. Los 19 archivos rastreados eran código, recursos usados por la aplicación, pruebas y documentación; las capturas son evidencia documental necesaria. No se retiró ningún archivo del índice. `.venv/`, cachés de Python y `entregables/` estaban ignorados y se conservaron localmente.

Se amplió `.gitignore` para incluir cachés de análisis, entornos virtuales, credenciales y configuración privada local, archivos de persistencia local, logs, temporales, paquetes ZIP, artefactos Python y `.vercel/`. Se añadió `.env.example`: declara que la aplicación actual no requiere variables; las referencias a PostgreSQL/Supabase, Storage y una posible clave de Flask están comentadas como planificación futura, sin valores ni dependencias de código. No existen carpetas ni implementaciones vacías para esos servicios.

Se inspeccionó el contenido de los archivos rastreados y el historial local disponible buscando patrones comunes de secretos y rutas personales. No se encontraron coincidencias. Esta comprobación estática no garantiza detectar todos los secretos o datos personales, y no sustituye herramientas especializadas ni una auditoría de permisos de GitHub. No se reescribió el historial. El proyecto utiliza Git y está alojado en GitHub; esta tarea no publica cambios.

Las observaciones del profesor sobre características detalladas y fotografías reales siguen pendientes de implementación. PostgreSQL, Supabase (incluido Storage) y Vercel tampoco están implementados/configurados. Antes de migrar se deben acordar el modelo y propiedad de datos, acceso y credenciales, tratamiento de fotografías y criterios de despliegue. La preparación de higiene no modifica reglas, rutas, dependencias ni funcionalidades del segundo avance.
