# Instrucciones para continuar

Proyecto académico de Programación Estructurada, UAM Managua, Grupo 7. Rama de esta implementación: `feature/supabase-migration`. Fecha límite: 30 de noviembre de 2026. Publicación pública prevista hasta el 27 de noviembre de 2026; no crear una automatización de retirada sin petición expresa.

## Antes de editar

Lee README y los documentos de arquitectura, decisiones, avance y roadmap. Inspecciona rama, estado y diff; conserva cambios ajenos y no uses `git reset --hard`. La autorización del usuario en la conversación prevalece sobre restricciones históricas del segundo avance o Fase 1.

## Arquitectura y alcance

- Python y Flask mediante funciones y módulos, sin ORM ni clases de dominio. Las clases de excepciones y dobles de prueba son auxiliares, no un nuevo modelo de dominio.
- `vehiculos.py`: validación; `persistencia.py`: anuncios/idempotencia; `persistencia_fotos.py`: transacciones de fotos y recuperación; `limites_login.py`: límite de acceso PostgreSQL; `imagenes.py`: Pillow; `almacenamiento.py`: adaptador REST Storage; `app.py`: HTTP/sesión/CSRF.
- PostgreSQL 17 es la fuente de verdad. Proyecto autorizado `rtcygltmrtulyeezaaac`, región `us-west-2`; bucket existente `vehiculos`. No crear proyectos, ramas Supabase, buckets ni servicios de pago sin autorización específica.
- Navegador → Flask para datos y escrituras. Las imágenes públicas se consultan por URL de Storage. JavaScript no recibe credenciales ni usa localStorage operativo.
- Campo placa solo para administración; no inferir que una foto oculta automáticamente una placa visible. Equipamiento: TRUE=sí, FALSE=no, NULL=no especificado; no inferirlo desde descripciones.
- No ampliar a buscador avanzado, precio máximo, chat, pagos, contacto real, cuentas completas ni validación técnica oficial sin nueva autorización.

## Contratos y límites

GET catálogo/item devuelven `fotografias` y omiten placa sin sesión. POST anuncio recibe `{vehiculo}` más `Idempotency-Key` UUID; PUT conserva ID y fotos; PATCH cambia disponibilidad. No aceptar la colección completa ni IDs elegidos por el cliente. Precio USD en centavos enteros, máximo 500 anuncios.

POST/PUT de fotografías usan multipart con un solo campo `fotografia`, UUID y CSRF; DELETE exige sesión y CSRF. Hasta cinco fotos por vehículo. Originales JPEG/PNG/WebP hasta 10.000.000 bytes se comprimen en navegador a WebP ≤1600 px y ≤1.000.000 bytes, calidad inicial 78 %. El servidor impone solicitud ≤1.100.000 bytes y vuelve a decodificar/recodificar sin metadatos. No Base64 en PostgreSQL ni archivos persistentes en Vercel.

No borres objetos anteriores antes del commit de sustitución. Reserva durable antes de subir, referencias y cola en transacción. `pendientes_limpieza` es de solo lectura; **reclamar_limpieza debe autorizar cada borrado** bajo bloqueo de operación antes de cola, cancelar reservas expiradas y proteger mediante lease de dos minutos. No quitar esas garantías ni usar un listado antiguo como permiso para borrar. Los errores conservan trabajo recuperable.

## Seguridad

Secretos en entorno, `.env` ignorado, `.env.example` sin valores reales. `SUPABASE_SECRET_KEY` moderna es preferida; alternativa JWT `SUPABASE_SERVICE_ROLE_KEY`. Nunca imprimir claves, DSN, hash administrativo ni mensajes internos del proveedor.

Cada escritura verifica administración y CSRF. Cookies HttpOnly/SameSite=Lax y Secure en HTTPS; Vercel fuerza Secure. Límite de cinco intentos/10 minutos reservado atómicamente en PostgreSQL antes del hash; clave HMAC de `remote_addr`, sin confiar en X-Forwarded-For arbitrario. Si falla PostgreSQL, el login falla cerrado. No sustituirlo por memoria de un worker o cookies.

Preview de Vercel es siempre de solo lectura en esta entrega. `APP_READ_ONLY=false` no debe desbloquearlo. Production requiere aprobación final del usuario. La cuenta administrativa compartida no ofrece atribución individual ni MFA; documentar antes de ampliar exposición.

RLS habilitado en las seis tablas y sin privilegios directos para anon/authenticated/PUBLIC. Los avisos INFO RLS sin políticas son deliberados. No añadir políticas abiertas para silenciarlos. Los índices nuevos sin uso no deben eliminarse por un aviso INFO inmediatamente después de crearlos.

## Migraciones, datos y pruebas

Inspecciona esquema, migraciones, identidad y costos antes de cambios remotos. Versiona SQL y usa Supabase MCP para DDL remoto. No volver a ejecutar la semilla ni modificar los seis anuncios con pruebas. No hacer operaciones destructivas sobre datos reales sin autorización concreta.

Las migraciones están en `supabase/migrations`. La tercera añade cuatro tablas de coordinación sin cambiar anuncios existentes. Los cargadores de semillas/importación son explícitos; localStorage antiguo permanece intacto y las exportaciones se respaldan fuera del repositorio.

Sigue README para Windows/Linux y usa el Python del entorno. Suite: `python -m unittest discover -s tests -v`. Para pruebas reales, `TEST_DATABASE_URL` debe indicar un clúster local aislado y base `grupo7_test*` con permiso de crear bases/roles. La fixture crea y elimina solo bases nuevas UUID; nunca admite Supabase. Sin variable, las pruebas reales se omiten. Distingue PostgreSQL real, Pillow real y Storage simulado.

Verifica los cambios con pruebas apropiadas, compilación Python, sintaxis JS, `pip check`, `git diff --check` y revisión del diff. No repitas pruebas amplias sin cambios o fallos que lo justifiquen. Prueba el flujo visual al cambiar frontend. Detén procesos temporales al terminar y no incluyas logs, fixtures, capturas generadas, entornos ni secretos en Git.

## Vercel y Git

`app.py` expone `app`; `.python-version` fija Python 3.14 y `vercel.json` declara Flask. Los recursos que Flask referencia bajo `/static/` también deben estar versionados byte por byte en `public/static/`, que Vercel sirve desde CDN. `scripts/preparar_vercel.py` sincroniza esas copias; no las excluyas de Git ni de `.vercelignore`. No persistir datos en el disco de funciones.

La tarea actual autoriza commits locales verificados, no push, merge a main ni Production. No reescribas historial ni borres ramas. Antes de cualquier publicación confirma destino y autorización. Coordina subagentes con contratos y archivos separados; informa trabajo real, limitaciones y estado final.
