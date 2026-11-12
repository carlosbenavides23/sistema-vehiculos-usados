# V7.7 — Ficha técnica ampliada

## Esquema y aplicación

La migración `20261112191129_v77_ficha_tecnica.sql` agrega a `public.vehiculos` los campos opcionales `version` (40), `motor` (60), `numero_puertas` (1–10), `capacidad_pasajeros` (1–100), `camara_reversa` y `bluetooth`. Todos admiten `NULL`; los booleanos distinguen `TRUE`, `FALSE` y desconocido. La migración no elimina columnas ni añade atributos obligatorios. Se aplica primero en el entorno destino y después se despliega el código que consulta esas columnas; el código anterior continúa ignorándolas.

## Categorías canónicas

`tipos_vehiculo.py` mantiene códigos, etiquetas y alias en una sola fuente. Las altas nuevas aceptan únicamente los códigos o etiquetas reconocidos; el servidor convierte variantes conocidas a códigos estables. Las etiquetas para filtros y formularios Jinja se generan desde esa misma fuente. El catálogo conserva compatibilidad con enlaces de filtro que todavía usen etiquetas históricas.

## Registros históricos

La migración convierte variantes inequívocas enumeradas en el `CASE` (por ejemplo, `Sedán` a `sedan` y `Sport Utility Vehicle` a `suv`). Los valores no reconocidos no se sustituyen por `Otro`: permanecen intactos. En formularios administrativos se muestran como una opción histórica con ese texto. Al editar otro dato, el servidor permite conservar exclusivamente el valor desconocido que ya tenía esa fila; una selección de una categoría estándar lo reemplaza explícitamente. Las versiones antiguas de cliente que omitan atributos V7.7 preservan los valores existentes; enviar `null` explícito permite limpiarlos.

## Presentación y filtros

El catálogo filtra por la categoría canónica. Las tarjetas muestran la categoría si está informada; la ficha completa muestra versión, motor, puertas, pasajeros y equipamiento booleano solamente cuando hay datos. No se infieren características de la descripción ni se presenta el anuncio como una certificación mecánica. Valores de texto se renderizan como texto, nunca HTML.

## Verificación y límites

Usar PostgreSQL 17 local aislado para migración, CRUD, constraints, preservación de tipos desconocidos, filtros y autorización por propietario. Las pruebas visuales cubren 1440 y 390 px con contenido ficticio. Esta migración versionada no se aplica automáticamente a Supabase remoto.
