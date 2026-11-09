# Retiro de publicaciones

El retiro es lógico: conserva la fila, sus fotografías, objetos de Storage y conversaciones. El catálogo, la ficha y el inventario normales solo muestran vehículos activos. Las conversaciones conservan su historial; el comprador no puede enviar nuevos mensajes ni abrir la ficha retirada. Los objetos de un bucket público pueden seguir accesibles mediante sus URLs anteriores: el retiro no es un mecanismo de borrado ni de privacidad de fotografías.

La operación exige administración, CSRF y la versión observada. Bloquea la fila del vehículo y rechaza el retiro si hay una reserva de fotografía vigente; la reserva debe terminar, cancelarse o expirar. Las operaciones de fotografías y los nuevos mensajes adquieren el mismo bloqueo antes de comprobar el estado activo. No se borran objetos ni referencias durante el retiro. Las reservas expiradas continúan sujetas a la cola existente de limpieza.

El límite existente de 500 registros sigue contando las filas retiradas, porque se conservan. El retiro no libera capacidad de almacenamiento ni elimina el historial.

## Orden de despliegue

Aplicar primero, en el entorno autorizado, la migración `20261109161130_retiro_logico_vehiculos.sql`; después desplegar el código de esta rama. La columna nueva es nullable y la versión anterior la ignora. El código nuevo requiere que la columna ya exista. No se ha aplicado la migración a Production.
