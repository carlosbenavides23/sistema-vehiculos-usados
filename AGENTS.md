# Instrucciones para continuar

Proyecto académico de Programación Estructurada de UAM Managua, Grupo 7: sistema de publicación y consulta de vehículos usados. El alcance actual es el segundo avance, registro y edición de vehículos. Fecha límite total: **30 de noviembre de 2026**; otras presentaciones pendientes de confirmar.

## Restricciones
- Python y Flask; funciones y módulos, sin clases propias, ORM ni arquitectura empresarial. Python valida entradas y estado, asigna identificadores, registra, edita y cambia disponibilidad.
- HTML, CSS y JavaScript sin compilador frontend. JavaScript captura eventos, solicita operaciones a Flask, renderiza y conserva el resultado en `localStorage`. No duplicar las reglas de negocio de Python.
- Persistencia provisional exclusivamente en el navegador, clave `vehiculos_demo_v1`, formato versionado. Flask procesa cada estado recibido sin colección global ni archivos de datos. No bases de datos ni servicios remotos.
- No ampliar a cuentas, pagos, contacto real, buscador avanzado, filtro de precio máximo, certificación ni validación técnica del vehículo. Definir y documentar cualquier futura ampliación antes de implementarla.
- No descargar ni generar imágenes; usar SVG local sencillo. Los datos y contactos son ficticios.
- No hacer commit, push, merge, despliegue ni publicación salvo instrucción explícita del usuario. Un commit local autorizado no implica autorización para push o merge.
- Mantener `.env.example` sin valores de credenciales; nunca registrar `.env`, llaves privadas ni credenciales locales. Al cambiar dependencias actuales, actualizar `requirements.txt`.

## Antes de editar
Leer los AGENTS.md aplicables, README y docs. Inspeccionar `git status --short`, `git branch --show-current` y el diff. Conservar cambios ajenos; no usar `git reset --hard`. No reorganizar fuera del alcance. Actualizar documentación cuando cambie una decisión o contrato.

## Ejecución y verificación (PowerShell, desde la raíz)
`py -m venv .venv` crea el entorno. `.\.venv\Scripts\python.exe -m pip install -r requirements.txt` instala Flask. `.\.venv\Scripts\python.exe app.py` inicia el servidor local en http://127.0.0.1:5000; Ctrl+C lo detiene. `.\.venv\Scripts\python.exe -m unittest discover -s tests -v` ejecuta las pruebas de Python. Verificar además el flujo real en navegador y pantalla estrecha. Detener procesos temporales. No afirmar que una comprobación se ejecutó sin evidencia; anotar resultados y límites reales en `docs/AVANCE_02.md`.

En Linux: `python3 -m venv .venv`, `./.venv/bin/python -m pip install -r requirements.txt`, `./.venv/bin/python app.py` y `./.venv/bin/python -m unittest discover -s tests -v`, respectivamente. Todos parten de la raíz; el README debe usar rutas relativas, sin directorios personales. Las descripciones deben mostrarse completas y los textos importantes ser legibles desde 320 px.

## Repositorio y preparación futura
El proyecto usa Git; mantener código, pruebas y documentación bajo seguimiento. `.gitignore` excluye entornos, cachés, secretos locales, bases de datos locales y artefactos generados, pero no código ni recursos necesarios. Conservar `.env.example` solo como documentación de variables: la aplicación actual no requiere configuración de entorno. PostgreSQL, Supabase, Storage y Vercel son posibilidades futuras sin implementación actual; no añadir carpetas vacías, dependencias ni configuración de despliegue hasta que se acuerde su diseño.

Para preparar una entrega, excluir entornos, Git, cachés, secretos, logs, arneses temporales y ZIP anteriores sin borrar esos elementos del directorio de trabajo. Usar una sola carpeta raíz `Grupo7_Sistema_Vehiculos_Usados_Avance02/`. Inspeccionar el ZIP, extraerlo en una carpeta temporal limpia, crear un entorno nuevo, instalar requirements y probar backend, arranque y navegador. Calcular SHA-256 después de finalizar el ZIP.

## Delegación
Antes de usar subagentes, acordar modelo y contrato HTTP, asignar archivos sin solapamiento e indicar restricciones y criterios. Backend: `app.py`, `vehiculos.py`, `tests/`, dependencias. Interfaz: `templates/`, `static/`. Agente principal: integración, documentación y verificación final. Un revisor puede inspeccionar después de integrar, sin editar archivos compartidos. No delegar dependencias sin definir el contrato; no crear agentes sin tarea útil. Informar qué se integró.

## Contrato del segundo avance
- Estado canónico: `{ "version": 1, "vehiculos": [...] }`. Vehículo: `id` entero positivo seguro para JavaScript, `marca`, `modelo`, `anio`, `kilometraje`, `precio_centavos` entero, `ubicacion`, `descripcion`, `disponibilidad` (`disponible` o `vendido`), `imagen` (`null` o `/static/img/vehiculo.svg`). Moneda de demostración: USD, decisión reversible.
- `POST /api/validar`: cuerpo `{estado}`; valida y devuelve el estado normalizado. Permite colección vacía.
- `POST /api/vehiculos`: `{estado, vehiculo}`. El formulario envía `marca`, `modelo`, `anio`, `kilometraje`, `precio_venta` como texto decimal, `ubicacion`, `descripcion`, `disponibilidad`; imagen opcional. Python convierte precio a centavos con Decimal y asigna `max(id)+1`.
- `PUT /api/vehiculos/<id>`: mismo cuerpo; conserva ID. `PATCH /api/vehiculos/<id>/disponibilidad`: `{estado, disponibilidad}`.
- Éxito: HTTP 200 (201 al registrar), `{ok:true, estado}`. Error: `{ok:false, mensaje, errores:{campo:mensaje}}`; 400 JSON/estado inválido, 422 campos inválidos, 404 ID inexistente. Error de estado asociado a `estado`.
- Campos canónicos estrictos; normalización de texto con trim. Marca/modelo 1–60 caracteres; ubicación 1–100; descripción 10–1000. Año entero 1900 hasta año actual+1; kilometraje entero no negativo; precio positivo con máximo dos decimales. Números canónicos enteros (sin booleanos), identificadores únicos. Importes e identificadores dentro del rango seguro de JavaScript. Límite de colección: 500 registros; documentarlo.
- El navegador valida un estado existente en Flask antes de habilitar operaciones. Solo guarda después de éxito. Si falta la clave, valida y guarda la semilla de `static/js/datos-demo.js`. Si está corrupta/incompatible no sobrescribe: bloquea edición y ofrece restablecimiento explícito confirmado. También maneja errores al leer/escribir almacenamiento. Bloquea envíos simultáneos. Fallos conservan estado e inputs. Restauración se valida en backend antes de guardar.
