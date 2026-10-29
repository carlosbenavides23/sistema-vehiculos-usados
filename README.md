# Sistema de publicación y consulta de vehículos usados

Proyecto académico de Programación Estructurada de la Universidad Americana (UAM), Managua. **Grupo 7**.

## Descripción y objetivo

El sistema aborda la organización de anuncios de vehículos usados mediante un prototipo que permite registrar vehículos, consultar un listado, editar datos y cambiar disponibilidad. El objetivo académico es aplicar programación estructurada en Python para validar y procesar estas operaciones.

## Alcance del segundo avance

El avance implementa registro, listado, edición conservando el identificador, cambio de disponibilidad y persistencia demostrativa en el navegador. Incluye seis vehículos ficticios iniciales y un formulario para registro y edición. No incorpora eliminación.

## Tecnologías actuales

- Python 3.10 o posterior y Flask.
- HTML, CSS y JavaScript sin framework ni proceso de compilación.
- `localStorage` del navegador como persistencia provisional.
- `unittest` para las pruebas automatizadas del backend.

## Requisitos

Python 3.10 o posterior, `pip` disponible en ese entorno, y un navegador moderno con JavaScript y almacenamiento del sitio habilitados. La aplicación debe abrirse a través de Flask, no directamente como un archivo HTML. No requiere Node.js para ejecutarse.

## Instalación y ejecución local

Abre una terminal en la raíz del repositorio, donde se encuentran `app.py`, `requirements.txt` y este README. Los comandos crean un entorno virtual, instalan las dependencias y luego inician el servidor local.

### Windows (PowerShell)

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe app.py
```

Si no está disponible el lanzador `py`, usa `python -m venv .venv` en el primer comando. No es necesario activar el entorno.

### Linux

```bash
python3 -m venv .venv
./.venv/bin/python -m pip install -r requirements.txt
./.venv/bin/python app.py
```

La instalación de Python debe incluir `venv`; algunas distribuciones lo proporcionan en un paquete separado.

Con el servidor activo, abre [http://127.0.0.1:5000](http://127.0.0.1:5000). Para detenerlo, presiona **Ctrl+C** en la terminal. En VS Code, ejecuta los comandos desde **Terminal → Nueva terminal**. Si aparece `ModuleNotFoundError: No module named 'flask'`, utiliza el ejecutable de `.venv` como se muestra arriba; Code Runner puede estar usando otra instalación de Python. Live Server no inicia el backend Flask.

## Pruebas

Desde la raíz del repositorio:

**Windows (PowerShell)**

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

**Linux**

```bash
./.venv/bin/python -m unittest discover -s tests -v
```

Las pruebas cubren validaciones, operaciones y rutas HTTP. Los resultados de las comprobaciones realizadas para este avance se detallan en [docs/AVANCE_02.md](docs/AVANCE_02.md).

## Estado actual y limitaciones

El segundo avance está implementado. Flask valida cada solicitud pero no almacena vehículos; el navegador conserva el estado versionado en `localStorage`. Los datos se limitan al navegador y origen donde se ejecuta la aplicación. Borrar los datos del sitio los elimina; no existe sincronización entre dispositivos ni resolución atómica de cambios entre pestañas.

El proyecto no está preparado para producción. Actualmente no usa PostgreSQL, Supabase, Storage ni Vercel; tampoco tiene autenticación, pagos, chat, contacto real con vendedores, buscador avanzado ni certificación técnica. Las observaciones del profesor sobre características detalladas y fotografías reales siguen pendientes de implementación. El significado de “poner números” y el alcance de la validación técnica del vehículo requieren aclaración antes de ampliar el sistema.

La fecha límite académica definitiva es el **30 de noviembre de 2026**. Las fechas de las presentaciones restantes están pendientes de confirmación.

## Preparación futura

El repositorio utiliza Git para control de versiones y excluye configuraciones locales, credenciales y archivos generados. [`.env.example`](.env.example) distingue la ausencia actual de variables requeridas de las variables que podrían definirse para una futura migración. La elección de base de datos, almacenamiento de imágenes y despliegue todavía requiere diseño y configuración; no hay migraciones, servicios ni despliegue implementados.

## Documentación

- [Arquitectura y contrato HTTP](docs/ARQUITECTURA.md)
- [Decisiones y cuestiones pendientes](docs/DECISIONES.md)
- [Estado y trabajo futuro](docs/ROADMAP.md)
- [Registro del segundo avance y verificaciones](docs/AVANCE_02.md)
- [Instrucciones duraderas para el proyecto](AGENTS.md)

## Equipo e institución

- Carlos Alberto Benavides Sandino.
- Alex Santiago Carballo Jarquín.
- Evenyer Fernando Solórzano López.

**Docente:** Carlos Iván Argüello Martínez.

**Institución:** Universidad Americana (UAM), Managua.
