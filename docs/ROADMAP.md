# Roadmap y cierre del proyecto

**Actualizado:** 18 de noviembre de 2026.  
**Estado:** cierre funcional de la versión V7.20.5, auditoría V7.21 **APTO CON OBSERVACIONES**, preparación de entrega académica.

El roadmap refleja el **estado actual**, no un compromiso de ampliar funcionalidades. Para la historia de entregas consultar [Evolución](EVOLUCION.md); para capacidades y restricciones actuales consultar [Estado actual](ESTADO_ACTUAL.md).

## 1. Hitos académicos documentados

| Hito | Fecha documentada | Situación |
| --- | --- | --- |
| Tercer avance | 30 de octubre de 2026 | Histórico: su alcance se integró y evolucionó. |
| Cuarto avance | 6 de noviembre de 2026 | Histórico: su alcance se integró y evolucionó. |
| Quinto avance | 13 de noviembre de 2026 | Fecha registrada en el roadmap anterior; verificar entrega académica por separado. |
| Auditoría final de aceptación | 18 de noviembre de 2026 | Ejecutada, **APTO CON OBSERVACIONES**. |
| Cierre técnico registrado | 20 de noviembre de 2026 | Fecha originalmente prevista para el cierre del proyecto; desarrollo funcional ya congelado. |
| Fin de publicación previsto | 27 de noviembre de 2026 | Fecha indicada en `AGENTS.md` histórico; no implica una retirada automática. |
| Fecha límite académica registrada | 30 de noviembre de 2026 | Referencia histórica de `AGENTS.md`; confirmar con el docente/equipo. |

Las fechas anteriores proceden de documentos del propio proyecto, que no siempre usaron la misma definición de «cierre». **No se afirma que exista una orden de apagar el sitio** ni se programa su retirada.

## 2. Estado de los entregables técnicos

| Entregable | Estado al corte | Observación |
| --- | --- | --- |
| PostgreSQL como fuente de verdad | Implementado | Persistencia y pruebas de integración con PostgreSQL 17 aislado. |
| Catálogo, búsqueda, filtros y fichas | Implementado | Navegación principal pública comprobada en Production. |
| Fotografías y galería WebP | Implementado | Consulta de WebP remota aprobada; escrituras reales de Storage no probadas en V7.21. |
| Cuentas y roles comprador/vendedor | Implementado | Autorización y flujos verificados con Auth simulado; verificación remota de login pendiente. |
| Inventario individual y retiro | Implementado | Pruebas de propietario, CSRF y concurrencia aprobadas en local. |
| Mensajería autenticada | Implementado | Recorridos y reintentos comprobados en local; envío remoto real pendiente de validación. |
| Perfil público de vendedor | Implementado | Perfil comprobado en Production. |
| Supresión de administración V6 | Implementado | V7.9 retiró login global y escritura anónima; se conserva archivo histórico autorizado. |
| Preview de solo lectura | Implementado | Política comprobada con configuración local simulada; Preview remoto no verificado en V7.21. |
| Despliegue público Vercel | READY a la fecha auditada | Coincide con `main`, SHA `336bf7f`. |
| Auditoría V7.21 | Completada | 28 pruebas localizadas y 8 PostgreSQL; sin defectos confirmados en escenarios auditados. |
| Documento de estado y evolución | Preparado en rama documental | Debe revisarse y fusionarse antes de considerarlo versión oficial de `main`. |

## 3. Pendientes para la presentación

No son nuevas funcionalidades:

1. **Validar en Production con datos ficticios controlados:** acceso comprador/vendedor, publicación de demostración, carga de foto y conversación. Evitar tocar publicaciones reales que no sean de prueba y respetar límites de datos/servicios.
2. **Preparar la demostración:** cuentas, anuncios con fotografías y un hilo de prueba que permita mostrar el flujo completo sin depender de registros improvisados.
3. **Ensayar:** visitante busca y ve una ficha; comprador contacta y lee/responde; vendedor crea/edita, gestiona fotos y responde.
4. **Revisar disponibilidad:** dominio público, recursos, servicio Auth y almacenamiento antes de exponer.
5. **Cerrar documentación:** aprobar los documentos vigentes y conservar los históricos sin confundir versiones.
6. **Decidir al final del curso** si mantener o retirar el sitio; no ejecutarlo automáticamente.

## 4. Política de congelación

No abrir funcionalidades de pagos, red social, estadísticas, reescrituras tecnológicas ni rediseños cosméticos. Solo contemplar correcciones localizadas si se confirma un error grave de funcionamiento, seguridad, integridad de datos o preparación de la demostración. Toda corrección debe probarse nuevamente y documentar su alcance.

**No ejecutar cambios remotos por este roadmap.** Un documento es una planificación, no una autorización de migraciones, modificaciones en Supabase, despliegues o purgas.

## 5. Referencias

- [Auditoría final V7.21](auditoria-final-v721.md)
- [Estado actual](ESTADO_ACTUAL.md)
- [Evolución del proyecto](EVOLUCION.md)
- [Decisiones](DECISIONES.md)
