# Arquitectura del segundo avance

## Componentes

- `app.py`: crea Flask, sirve el HTML y adapta solicitudes/respuestas HTTP. No almacena vehículos.
- `vehiculos.py`: funciones de validación del estado y de campos, registro, edición, asignación de ID y disponibilidad. No clases propias de dominio ni ORM.
- `templates/index.html` y `static/css/`: estructura accesible y presentación responsive.
- `static/js/datos-demo.js`: seis registros ficticios, separados de la interfaz.
- `static/js/`: interacción, llamadas HTTP, representación del listado y almacenamiento del resultado. No aplica las reglas definitivas de registro/edición.
- `static/img/vehiculo.svg`: ilustración local de demostración.
- `tests/`: pruebas con `unittest` de Python.

Las tarjetas muestran la descripción completa y adaptan su altura al contenido; CSS permite partir textos sin espacios para evitar desbordamientos. El formulario se organiza en una columna hasta 520 px, con etiquetas de 14 px, campos de 16 px y controles de al menos 44 px de alto. Estos ajustes son de presentación y no modifican el modelo ni el contrato HTTP.

## Repositorio y evolución

El proyecto utiliza Git para control de versiones. `.gitignore` excluye entornos locales, cachés, archivos privados y resultados generados, y conserva bajo seguimiento el código, recursos, pruebas y documentación necesarios. `.env.example` indica que el prototipo no requiere variables de entorno; los nombres comentados de Supabase y una futura clave de Flask son referencias de planificación, no configuración activa.

La arquitectura ejecutable continúa siendo Python/Flask sin persistencia en servidor y JavaScript con `localStorage`. PostgreSQL, Supabase, almacenamiento de imágenes y Vercel no están implementados ni configurados. Antes de migrar se debe decidir y documentar persistencia, credenciales, acceso, almacenamiento de fotografías y estrategia de despliegue. Las observaciones del profesor sobre características detalladas y fotografías reales siguen pendientes de implementación.

## Flujo

Al abrir, JavaScript lee `vehiculos_demo_v1`. Si no existe, propone la semilla; si existe, interpreta el JSON. Envía el estado a `/api/validar` antes de habilitar operaciones. Un JSON corrupto o un estado rechazado no se sobrescribe. Restablecer necesita una confirmación y valida la semilla antes de guardarla.

Para registrar/editar/cambiar disponibilidad: navegador → JSON con estado actual → ruta Flask → función Python → respuesta normalizada → escritura en `localStorage` → actualización de la interfaz. Un error conserva la colección anterior y los campos del formulario. Se bloquean operaciones simultáneas. Si no se puede guardar, no se presenta el resultado como persistido.

Python concentra la lógica porque la asignatura exige programación estructurada en Python y permite probar las reglas sin navegador. Las rutas comparten funciones de validación; JavaScript solo convierte los datos del formulario al formato de transporte y presenta respuestas. Las restricciones HTML ayudan a introducir datos, pero no sustituyen Python.

## Modelo canónico

```json
{
  "version": 1,
  "vehiculos": [{
    "id": 1,
    "marca": "Toyota",
    "modelo": "Corolla",
    "anio": 2019,
    "kilometraje": 68000,
    "precio_centavos": 1450000,
    "ubicacion": "Managua",
    "descripcion": "Vehículo ficticio para la demostración académica.",
    "disponibilidad": "disponible",
    "imagen": "/static/img/vehiculo.svg"
  }]
}
```

Moneda de demostración USD. `precio_centavos` es entero positivo: 1450000 representa USD 14,500.00. El formulario envía `precio_venta` como texto decimal (por ejemplo `"14500.00"`); Python usa `Decimal`, sin redondear silenciosamente fracciones de centavo. Al editar se conserva el ID; al registrar se usa el máximo ID existente más uno (1 para colección vacía). No hay eliminación.

Marca/modelo: 1–60 caracteres; ubicación: 1–100; descripción: 10–1000, tras recortar extremos. Año entero desde 1900 hasta año actual de Python +1. Kilometraje entero no negativo. Disponibilidad: `disponible` o `vendido`. Imagen opcional: `null` o la ruta SVG local indicada. El estado canónico requiere números enteros, excluye booleanos y comprueba IDs positivos únicos. Números enteros hasta 9007199254740991 para interoperar con JavaScript; hasta 500 vehículos. Se comprueba la estructura de todos los registros recibidos, no solo el vehículo editado.

## HTTP

Todas las rutas API reciben `Content-Type: application/json`. Éxito: `{ "ok": true, "estado": { ... } }`. Error: `{ "ok": false, "mensaje": "...", "errores": { "campo": "..." } }`. `estado` identifica errores de la colección.

| Método y ruta | Cuerpo | Resultado |
| --- | --- | --- |
| `GET /` | — | Página de demostración |
| `POST /api/validar` | `{estado}` | 200, estado validado; no guarda en servidor |
| `POST /api/vehiculos` | `{estado, vehiculo}` | 201, colección con nuevo ID |
| `PUT /api/vehiculos/<id>` | `{estado, vehiculo}` | 200, mismo ID con nuevos datos |
| `PATCH /api/vehiculos/<id>/disponibilidad` | `{estado, disponibilidad}` | 200, disponibilidad actualizada |

`vehiculo` de registro/edición contiene `marca`, `modelo`, `anio`, `kilometraje`, `precio_venta`, `ubicacion`, `descripcion`, `disponibilidad` e imagen opcional. Los campos numéricos del formulario pueden viajar como texto; Python los convierte. El cliente no elige un ID nuevo.

Errores: **400** JSON o estado inválido; **422** campos o disponibilidad inválidos; **404** ID inexistente; **405** método no admitido. La aplicación limita solicitudes a **4 MiB** y devuelve **413** si se excede el límite. Los errores API mantienen el formato JSON. Ningún error devuelve una colección alterada. Las funciones crean resultados nuevos sin mutar el estado de entrada.

No hay una fuente de verdad compartida: dos navegadores envían colecciones independientes. La interfaz detecta cambios en otra pestaña y compara el texto guardado antes y después de una solicitud para evitar sobrescribir una versión desactualizada; exige recargar el inventario. No hay transacciones atómicas entre pestañas ni conciliación de cambios. No se implementa autorización. El servidor se usa exclusivamente como prototipo local.
