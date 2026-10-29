# Sistema de publicación y consulta de vehículos usados

Segundo avance de Programación Estructurada, Universidad Americana (UAM), Managua. **Grupo 7**: Carlos Alberto Benavides Sandino, Alex Santiago Carballo Jarquín y Evenyer Fernando Solórzano López. Docente: Carlos Iván Argüello Martínez.

Prototipo académico para registrar vehículos, verlos en un listado, editar sus datos y cambiar su disponibilidad. Incluye seis vehículos ficticios iniciales. Python aplica las reglas mediante funciones; JavaScript conecta la interfaz con Flask y conserva el resultado en el navegador. No incluye cuentas ni contacto real con vendedores.

## Instalación y ejecución local

Requisitos: Python 3.10 o posterior y un navegador moderno con JavaScript y almacenamiento del sitio habilitados. Extrae el ZIP y abre una terminal **dentro de la carpeta raíz del proyecto**, donde están `README.md`, `app.py` y `requirements.txt`. Todos los comandos siguientes parten de esa carpeta.

### Windows (PowerShell)

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe app.py
```

`py -m venv .venv` crea un entorno Python aislado; el segundo comando instala las dependencias declaradas en ese entorno y el tercero inicia Flask en el equipo local. Si tu instalación no incluye el lanzador `py`, usa `python -m venv .venv` en el primer comando. No es necesario activar el entorno ni cambiar la política de ejecución de PowerShell.

### Linux

```bash
python3 -m venv .venv
./.venv/bin/python -m pip install -r requirements.txt
./.venv/bin/python app.py
```

Los comandos crean el entorno, instalan sus dependencias e inician Flask, respectivamente. La instalación de Python debe incluir el módulo `venv`; si la distribución lo proporciona por separado, instálalo mediante su gestor de paquetes antes de crear el entorno.

Abre [http://127.0.0.1:5000](http://127.0.0.1:5000). Debes entrar por esa dirección, no abriendo el HTML como archivo. Para detener el servidor, presiona **Ctrl+C** en la terminal donde lo ejecutaste. Para iniciarlo después solo hace falta el último comando.

En VS Code, ejecuta estos comandos desde **Terminal → Nueva terminal**. Si aparece `ModuleNotFoundError: No module named 'flask'`, comprueba que estés usando el ejecutable de `.venv` indicado arriba; Code Runner puede utilizar otro Python. Live Server no inicia el backend de esta aplicación.

Si modificas archivos Python o plantillas HTML, detén e inicia de nuevo el servidor y recarga la página; la depuración y la recarga automática están desactivadas.

## Demostración

1. En la primera apertura aparecen seis anuncios ficticios.
2. Usa **Registrar vehículo**, completa los campos y guarda. El precio de venta se introduce en USD con hasta dos decimales.
3. El registro aparece en el listado. Usa **Editar**, cambia un dato o la disponibilidad y guarda.
4. Para descartar una edición usa **Cancelar**; el registro anterior permanece intacto.
5. Recarga: se conservan registros y disponibilidad. Los errores corregibles conservan lo escrito.
6. **Restablecer demostración** requiere confirmación y sustituye los registros de ese navegador por los seis iniciales. Cancela la confirmación para conservarlos.

La aplicación también admite un estado válido sin vehículos y muestra un mensaje para registrar el primero; no ofrece eliminación en este avance.

## Persistencia y límites

La clave `vehiculos_demo_v1` contiene `{version: 1, vehiculos: [...]}` en `localStorage`. Cada operación envía el estado a Flask para validarlo y transformarlo; el navegador guarda solo una respuesta satisfactoria. Flask no conserva vehículos entre solicitudes. Si el estado está corrupto o tiene una versión incompatible, se bloquean las operaciones y se ofrece restablecer explícitamente; nunca se reemplaza silenciosamente. Los fallos de solicitud o almacenamiento se muestran sin anunciar una operación como guardada.

Los registros pertenecen al navegador y al origen: `localhost` y `127.0.0.1`, o puertos distintos, tienen estados distintos. No se comparten entre dispositivos, compradores y vendedores. Borrar los datos del sitio elimina la información. Se recomienda trabajar en una sola pestaña: no hay resolución de ediciones concurrentes. Hasta 500 registros por colección; la capacidad real también depende del navegador. Los datos recibidos del cliente no prueban propiedad ni autenticidad. La persistencia definitiva se decidirá posteriormente.

No hay base de datos, archivos de vehículos en el servidor, imágenes externas, servicios remotos, autenticación, pagos, chat, buscador avanzado, filtro de precio máximo, documentos ni certificación. USD es una decisión de demostración reversible. La futura **validación técnica del vehículo** está pendiente de definir.

## Pruebas y documentación

Windows (PowerShell):

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Linux:

```bash
./.venv/bin/python -m unittest discover -s tests -v
```

Estos comandos descubren y ejecutan las mismas pruebas de reglas y rutas HTTP, incluidos errores, identificadores y ausencia de modificaciones en operaciones fallidas. Son pruebas del backend; las comprobaciones del navegador y sus resultados se registran por separado en [docs/AVANCE_02.md](docs/AVANCE_02.md).

- [Arquitectura y contrato HTTP](docs/ARQUITECTURA.md).
- [Decisiones y preguntas pendientes](docs/DECISIONES.md).
- [Trabajo futuro y estados](docs/ROADMAP.md).
- [Instrucciones duraderas para agentes](AGENTS.md).

La fecha límite de todo el proyecto es el **30 de noviembre de 2026**. Las fechas de las presentaciones restantes están pendientes de confirmación.
