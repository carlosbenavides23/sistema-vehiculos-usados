# V7.2 — Publicaciones por vendedor

Esta rama depende de V7.1. Aplicar sus migraciones y después `20261112004250_v72_propiedad_vehiculos.sql` antes de desplegar. No se aplicaron migraciones remotas. Las rutas `/vendedor` y `/api/vendedor/*` requieren USER_AUTH_ENABLED y se rechazan en Vercel Production; la preparación V7 sigue siendo interna.

Flask verifica la identidad con Auth y el rol privado de PostgreSQL en cada solicitud. Un ContextVar limitado a la solicitud transmite el UUID verificado al repositorio; se limpia al terminar incluso ante errores. Las escrituras SQL de vehículos y los bloqueos de fotografías incluyen el propietario. Las rutas heredadas escriben únicamente filas con propietario NULL. El catálogo público conserva todas las publicaciones activas, sin exponer placa ni vendedor_id. El inventario V6 usa `/api/admin/vehiculos` y solo contiene heredados.

El vendedor utiliza el panel existente con su inventario y sin bandeja V6. No se transfiere la propiedad mediante JSON ni se modifican conversaciones. El trigger exige que el propietario tenga rol vendedor y no permite transferir una publicación ya asignada. La FK impide borrar una cuenta mientras sea propietaria de vehículos.

## Publicaciones heredadas

La migración deja vendedor_id=NULL para todos los registros existentes. No se asigna ninguna cuenta automáticamente. Para una transición posterior autorizada: verificar la identidad de Auth y su rol vendedor, pausar las escrituras V6 de esas publicaciones, abrir una transacción, bloquear las filas de vehículos con FOR UPDATE y comprobar que no haya reservas fotográficas vigentes. Asignar únicamente filas con vendedor_id IS NULL al UUID verificado y actualizar updated_at. Revisar el inventario del vendedor antes de cerrar la transición. No ofrecer esa operación a compradores ni aceptar transferencias de propietarios existentes.

Pruebas locales utilizan PostgreSQL 17 desechable y dobles de Auth/Storage. No equivalen a un recorrido contra Supabase Auth real. El catálogo V6, la administración global, el retiro y las reservas conservan sus mecanismos anteriores, añadiendo el ámbito de propiedad.
