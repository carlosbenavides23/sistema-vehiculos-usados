# V7.3.1 — Persistencia de conversaciones por cuenta

Esta etapa prepara PostgreSQL para conversaciones entre un comprador autenticado
y el vendedor dueño del vehículo. No cambia rutas Flask, interfaces ni el chat
anónimo existente; esos cambios pertenecen a las siguientes etapas de V7.3.

## Migración y despliegue

20261112010722_v73_chat_cuentas.sql es aditiva y debe aplicarse después de
20261112002005_v71_roles_usuarios.sql y
20261112004250_v72_propiedad_vehiculos.sql. No se aplicó en Supabase remoto.

El nuevo modelo usa conversaciones_cuentas y mensajes_chat_cuentas. Cada
conversación vincula un comprador de roles_usuarios y un vehículo; el vendedor
se obtiene mediante vehiculos.vendedor_id y no se duplica. Una restricción
única impide más de una conversación por pareja comprador/vehículo. El trigger
verifica el rol comprador, vendedor dueño y estado activo al crearla; bloquea la
fila del vehículo para serializar la creación con el retiro lógico. Los mensajes
persisten autor autenticado, remitente, contenido, huella, clave de idempotencia
y orden por identidad.

Las dos tablas tienen RLS activo, sin políticas ni privilegios para
PUBLIC, anon o authenticated, siguiendo el acceso servidor Flask del
proyecto. Las conversaciones, mensajes y visitantes anónimos anteriores no se
copian, eliminan ni alteran. Su limpieza requiere otra decisión y migración.

## Repositorio

persistencia_chat_cuentas.py recibe UUIDs ya verificados por Flask, verifica
que el rol exista en PostgreSQL y aplica el ámbito de comprador o vendedor en
las propias consultas. Expone funciones para crear/recuperar, listar por
participante con cursor, consultar conversación e historial autorizado, enviar
como comprador, responder como vendedor y marcar como atendida. Los mensajes
conservan el máximo de 4.000 caracteres, la cuota de ocho envíos de comprador
por minuto y reintentos idempotentes.

Los historiales previos de una publicación retirada continúan siendo accesibles
a sus participantes, pero la publicación retirada no admite nuevos mensajes;
una publicación retirada o heredada sin propietario no admite una conversación
nueva. La API HTTP todavía no llama a este módulo;
V7.3.2 debe integrar las funciones sin aceptar IDs de identidad como
credenciales ni reutilizar los endpoints anónimos.

## Verificación

Las pruebas de tests/test_chat_cuentas_persistencia.py aplican todas las
migraciones a una base PostgreSQL 17 temporal local creada por la fixture
base_aislada. Usan dos compradores, dos vendedores y publicaciones heredadas,
activas y retiradas. También se conservan y ejecutan las pruebas de regresión
tests/test_chat_persistencia.py. Esto prueba PostgreSQL local, no Supabase Auth
remoto, y no autoriza aplicar la migración en Production.
