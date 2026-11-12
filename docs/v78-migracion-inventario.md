# V7.8 — Transferencia controlada de inventario heredado

## Informe previo (solo lectura, 12 de noviembre de 2026)

Proyecto consultado por Supabase MCP: `rtcygltmrtulyeezaaac`. Se observaron **18 vehículos**, IDs **1–18**, todos con `vendedor_id IS NULL`, ninguno retirado; **19 fotografías**, **4 conversaciones anónimas**, **0 conversaciones entre cuentas** y **0 reservas fotográficas pendientes**. Las seis columnas V7.7 existen. Ninguna operación remota de escritura fue ejecutada.

La consulta `roles_usuarios JOIN auth.users` encontró un único vendedor existente: `64cb5d57-1e03-4e13-b7be-eed4aa68e4dd`. Es el candidato verificado por UUID y rol, no por su nombre visible. Confirmar operativamente que sea la cuenta destinataria del proyecto antes de ejecutar. La herramienta verifica de nuevo ambas tablas en cada fase; no crea ni modifica identidades de Auth.

```sql
SELECT r.usuario_id, r.rol
FROM public.roles_usuarios r JOIN auth.users u ON u.id = r.usuario_id
WHERE r.usuario_id = :uuid_destinatario AND r.rol = 'vendedor';
SELECT count(*), array_agg(id ORDER BY id)
FROM public.vehiculos WHERE vendedor_id IS NULL;
```

Este informe es una fotografía temporal, no un permiso para omitir el nuevo plan.

## Herramienta y respaldo

`scripts/transferir_inventario.py` reutiliza la conexión TLS de persistencia pero **no carga `.env`**. Requiere `DATABASE_URL` ya configurada en un entorno de mantenimiento autorizado. No extrae credenciales de CLI ni del navegador y no muestra DSN, host o contraseña. No es un endpoint ni una acción del panel. No requiere migración, nuevas dependencias, cambios de RLS ni concesiones a roles públicos.

El modo predeterminado es una transacción de lectura repetible y de solo lectura. Valida cuenta y rol, espera exactamente 18 heredados y genera un archivo JSON con todas sus columnas originales, UUID destinatario, identificador de operación, fecha, rol PostgreSQL operador y huellas de las relaciones. Incluye una huella de integridad del documento y otra que lo vincula a la conexión de mantenimiento, sin guardar sus parámetros. La huella detecta modificaciones accidentales; el plan no es una autorización criptográfica ni debe aceptarse de terceros.

El archivo se crea con exclusión de sobrescritura y `fsync`, **fuera del repositorio**. Contiene información administrativa (incluidas placas), por lo que debe quedar en una carpeta privada con ACL del operador, sin sincronización pública. En Unix se crea con modo 0600; en Windows revisar la ACL heredada de la carpeta. Conservar una segunda copia verificada antes de aplicar. No sustituye un respaldo completo de PostgreSQL ni de los objetos binarios de Storage: esta operación no escribe en Storage y solo modifica la propiedad.

## Transacción y concurrencia

La aplicación permite asignar NULL → vendedor mediante el trigger V7.2 y prohíbe reasignaciones posteriores. La transferencia mantiene esa garantía y solo ejecuta:

```sql
BEGIN;
-- lock_timeout 5s, statement_timeout 30s; bloqueos sobre las tablas relacionadas.
-- Validación de Auth/rol, instantánea completa y huellas antes del UPDATE.
UPDATE public.vehiculos SET vendedor_id = :uuid_destinatario
WHERE id = ANY(:ids_del_plan) AND vendedor_id IS NULL RETURNING id;
-- Exigir exactamente 18 filas y verificar todas las columnas y relaciones.
COMMIT;
```

El código usa parámetros psycopg y bloquea escritores con `SHARE ROW EXCLUSIVE` en orden consistente: vehículos, fotografías, idempotencia, reservas, cola Storage, conversaciones y mensajes de ambas modalidades. PostgreSQL mantiene los bloqueos hasta terminar la transacción ([documentación](https://www.postgresql.org/docs/17/sql-lock.html)). Bloquea también las filas de identidad/rol contra eliminación concurrente. Los tiempos máximos abortan la operación ante actividad concurrente incompatible. Se recomienda una ventana de mantenimiento breve.

El plan deja de ser aplicable si cambian vehículos, relaciones o el conjunto sin propietario. Rechaza reservas pendientes y relaciones nuevas no contempladas. No cambia IDs, precios, descripción, disponibilidad, fechas, retiro, fotografías ni mensajes. Tras la asignación, las consultas del vendedor encuentran esas mismas filas; las del administrador heredado ya no las incluyen. La autorización antigua de una petición en curso no concede derechos: sus escrituras siguen exigiendo `vendedor_id IS NULL` en persistencia. No se eliminó el panel heredado.

Cada intento reserva un recibo local antes de escribir; después del commit crea un archivo `.confirmado`. Un fallo de red o del disco tras commit puede dejar un recibo sin confirmación: **no asumir que fracasó**. Repetir el mismo plan reconoce `ya_aplicado` si el estado coincide; si hay cambios posteriores, detenerse para inspección. El plan original nunca se reemplaza.

## Relaciones y chat

- `vehiculo_fotografias`, `fotografia_operaciones`, `solicitudes_idempotentes` referencian el ID, que permanece igual. No se renombran rutas Storage. Los bloqueos y el rechazo de reservas evitan transferir mientras una subida permanece abierta.
- `conversaciones`/`mensajes_chat` anónimos conservan sus referencias y su acceso administrativo actual. **No se convierten en conversaciones privadas ni se vinculan sus visitantes a cuentas.** El vendedor no recibe acceso a esos mensajes históricos mediante esta transferencia.
- `conversaciones_cuentas`/`mensajes_chat_cuentas` resuelven el vendedor a través del vehículo. Nuevos chats privados pueden iniciarse tras asignarlo, según configuración V7 vigente. No se habilitan flags remotos.
- Publicación, edición, disponibilidad, retiro y fotografías mantienen sus controles de propiedad; otros vendedores y la administración global no ganan acceso a publicaciones transferidas.

## Reversión conservadora

`--rollback` verifica el mismo plan y exige que las 18 filas sigan siendo exactamente las respaldadas salvo `vendedor_id`, y que ninguna relación haya cambiado. Si el vendedor editó, retiró, añadió fotos o recibió un chat privado, **se rechaza la reversión**; no se borran datos para forzarla. En esos casos se necesita revisar y diseñar una recuperación específica.

El trigger V7.2 impide restaurar el propietario a NULL. Por ello la reversión es exclusivamente para un **operador propietario de la tabla**, con bloqueo `ACCESS EXCLUSIVE` de vehículos. Dentro de una sola transacción desactiva **solo `v72_propietario`**, actualiza los IDs verificados con propietario destinatario, reactiva el trigger y verifica los datos. No desactiva RLS, otros triggers ni las FK. Cualquier error revierte también el DDL; una prueba inyecta un fallo después del UPDATE y comprueba propietario y trigger intactos. No dar estos privilegios al usuario ordinario de Flask.

## Ejecución posterior autorizada (PowerShell)

Desde el repositorio con el entorno Python instalado y una conexión de mantenimiento ya configurada, sin imprimir secretos:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\Backups\Supabase" | Out-Null
$planV78 = "$env:USERPROFILE\Backups\Supabase\v78-inventario-plan.json"
python scripts/transferir_inventario.py --seller 64cb5d57-1e03-4e13-b7be-eed4aa68e4dd --expected-count 18 --plan $planV78
```

Revisar el JSON, UUID, IDs y las 18 filas; conservar copia privada y verificar su hash. Confirmar que la cuenta y el destino sean los previstos. **Estos siguientes comandos se reservan para la ejecución controlada autorizada posteriormente; no se ejecutaron en Production:**

```powershell
python scripts/transferir_inventario.py --plan $planV78 --apply
# Comprobación idempotente sin nuevas modificaciones:
python scripts/transferir_inventario.py --plan $planV78 --apply
# Solo si se decide revertir y las comprobaciones conservadoras lo permiten:
python scripts/transferir_inventario.py --plan $planV78 --rollback
```

Verificar por SQL el UUID de los 18 IDs y conteos de fotografías/conversaciones. Consultar el inventario autenticado del vendedor, la ficha pública y denegación de otra cuenta. La herramienta verifica el mismo estado completo antes del commit; los recibos listan los IDs y el número efectivamente actualizado. Una segunda aplicación debe devolver cero. Cambiar de conexión de mantenimiento obliga a revisar y generar un plan nuevo; no editar el hash para saltar la vinculación.

## Propuesta de enriquecimiento (sin aplicar)

`data/propuesta_fichas_v78.json` identifica los 18 vehículos e incluye los ocho atributos solicitados y evidencia por registro. Todas las versiones y motores quedan desconocidos: no hay evidencia suficiente. No se infieren puertas ni pasajeros por modelo o doble cabina. Los NULL propuestos **no son instrucciones de borrar**. Toda modificación posterior necesita revisión de valores actuales y autorización independiente; la herramienta de transferencia nunca aplica enriquecimiento.

Datos explícitos aprovechables: Corolla #1 cámara y sedán; Tucson #2 SUV; Swift #3 cinco puertas (carrocería aún no demostrada); Frontier #4 pickup; Rio #5 sedán/Bluetooth; CR-V #6 SUV/cinco pasajeros/cámara. IDs 7–10 y 12–18 conservan su tipo canónico actual. Picanto #11 conserva `compacto` como histórico sin convertirlo automáticamente a hatchback. No hay suposiciones técnicas aprobadas.

## Verificación

Pruebas PostgreSQL 17 locales con 18 vehículos ficticios sin propietario, otro vendedor, un comprador, fotografías y conversación anónima: transferencia exacta, idempotencia con conexiones independientes, reversión exacta, rollback ante fallo, CLI/respaldo/recibos, roles inválidos, plan alterado, cambios posteriores, reservas pendientes, acceso por propietario y chats privados tras la transferencia. Las regresiones HTTP existentes del vendedor cubren edición, retiro y fotografías con dos vendedores y comprador. No se realizaron escrituras ni pruebas funcionales con cuentas reales en Production.
