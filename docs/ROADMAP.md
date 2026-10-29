# Estado y trabajo futuro

Fecha límite: **30 de noviembre de 2026**. La publicación pública prevista termina el **27 de noviembre de 2026**. No se inventan fechas para las presentaciones restantes ni se programa automáticamente una retirada.

| Elemento | Estado | Criterio pendiente |
| --- | --- | --- |
| Higiene del repositorio | Integrada en main previamente | Mantener secretos, entornos y archivos generados fuera de Git. |
| Segundo avance | Histórico, completado | Su persistencia localStorage quedó reemplazada; evidencia preservada en AVANCE_02. |
| PostgreSQL | Implementado y probado localmente con PostgreSQL 17 real | Verificar Flask contra el proyecto remoto cuando estén configuradas las credenciales. Los seis anuncios remotos se conservan. |
| Características opcionales | Implementadas | Equipamiento triestado y placa solo administrativa; comprobados en API y navegador. |
| Fotografías | Código completo y flujo local verificado | Comprobar credenciales y operaciones contra Supabase Storage real en datos autorizados separados. No acreditar el doble local como prueba remota. |
| Administración | Implementada | Sesión/CSRF, scrypt, límite persistente e idempotencia; revisar responsabilidad compartida y secretos antes de exposición. |
| Vercel | Configuración preparada | Verificar conectividad y, si es viable sin costo, Preview de solo lectura; no publicar Production sin aprobación. |
| Presentación final | Pendiente | Demostrar únicamente lo realmente probado y completar documentación antes de la fecha límite. |

Las tres migraciones del proyecto autorizado cubren esquema inicial, semillas y coordinación de administración/fotos/idempotencia. Las seis tablas tienen RLS y el acceso directo público está cerrado. Los avisos INFO por ausencia de políticas abiertas e índices recién creados se documentan sin relajar permisos ni eliminar índices necesarios.

Antes de Production: configuración privada por ambiente, conexión TLS/pooler, comprobación remota real, revisión de fotos públicas, acceso del equipo, recuperación/limpieza y aprobación del despliegue definitivo. Preview permanece siempre de consulta en esta entrega; un ambiente de escritura separado requiere un cambio explícito posterior.

No se implementan todavía buscador avanzado, filtro de precio máximo, chat, pagos, contacto real, cuentas completas ni validación técnica oficial. El docente debe aclarar “poner números” y cualquier alcance de certificación antes de desarrollarlo.
