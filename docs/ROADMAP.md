# Estado y trabajo futuro

Fecha límite absoluta de todo el proyecto: **30 de noviembre de 2026**. Las fechas de las presentaciones restantes están pendientes de confirmación; no se asignan fechas inventadas a los avances.

| Elemento | Estado | Dependencias y aceptación general |
| --- | --- | --- |
| Segundo avance: registro y edición | Implementado y verificado | Registro, edición con mismo ID, cancelación, disponibilidad y recarga comprobados; 34 pruebas Python aprobadas y flujo real en navegador |
| Persistencia provisional | Implementada y verificada | Estado versionado, corrupción y versión incompatible sin sobrescritura, errores visibles y restablecimiento confirmado; sin base de datos |
| Búsqueda y fichas de vehículos | Pendiente, fuera del avance | Acordar campos de búsqueda y contenido de ficha. Encontrar registros y mostrar datos consistentes; no incluir filtro de precio máximo |
| Contacto e integración | Pendiente, fuera del avance | Definir destinatarios, privacidad y servicios; acordar una interacción demostrable y autorizada |
| Validación técnica del vehículo | Pendiente de definición | Confirmar quién revisa, criterios, evidencia y resultado antes de diseñar o implementar; no suponer certificación |
| Persistencia definitiva | Pendiente de decisión | Acordar cómo compartir datos, identidad y continuidad entre dispositivos; documentar diseño antes de implementar |
| Presentación final | Pendiente | Integrar únicamente funciones acordadas, ejecutar demostración y actualizar documentación antes del límite total |

Los detalles y resultados verificables del segundo avance están en `AVANCE_02.md`. El código actual no implica que los elementos futuros estén implementados. Las ampliaciones se dividirán en tareas delimitadas con contrato y criterios antes de tocar código.
