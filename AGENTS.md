# Guía para continuar o mantener el proyecto

**Proyecto:** Sistema de vehículos usados, Grupo 7, Programación Estructurada, UAM Managua.  
**Estado de referencia:** `main` en `336bf7f` (V7.20.5); auditoría V7.21 del 18-11-2026: **APTO CON OBSERVACIONES**.  
**Objetivo vigente:** preparar demostración y entrega. **No iniciar otra fase funcional sin un pedido explícito**.

Leer primero [README](README.md), [estado actual](docs/ESTADO_ACTUAL.md), [evolución](docs/EVOLUCION.md), [arquitectura](docs/ARQUITECTURA.md), [decisiones](docs/DECISIONES.md), [roadmap](docs/ROADMAP.md) y [auditoría final](docs/auditoria-final-v721.md). Los avances y documentos de V6/V7 tempranas representan estados **históricos** y pueden contener instrucciones superadas.

## 1. Antes de cualquier cambio

1. Inspeccionar rama, estado, últimos commits y diff. No sobrescribir trabajo ajeno ni usar restablecimientos destructivos.
2. Identificar si la tarea es **documentación**, **preparación de presentación** o **corrección de defecto**. El desarrollo funcional está congelado.
3. Respetar instrucciones concretas de la solicitud vigente; una nota histórica no autoriza nuevas operaciones.
4. Mantener separadas las pruebas locales de las comprobaciones reales de Supabase/Vercel. No afirmar que un doble de servicio valida Production.
5. Para modificaciones, probar exactamente las rutas/recursos afectados; evitar suites costosas sin una razón verificable.
6. No hacer push, merge, despliegues, migraciones, limpiezas remotas ni cambios de permisos por inferencia. Cada operación requiere autorización acorde a su impacto.

## 2. Arquitectura y rol de los componentes

- Backend Python/Flask con funciones y módulos separados; psycopg + SQL parametrizado, sin ORM ni clases de dominio obligatorias.
- PostgreSQL 17 como fuente de verdad; Supabase Auth para cuentas comprador/vendedor; Supabase Storage para fotos WebP.
- Frontend HTML/CSS/JavaScript nativo con Jinja. Recursos bajo `static/` y copia de despliegue en `public/static/`.
- `app.py` gestiona rutas, sesiones, CSRF, autorización y vistas; `vehiculos.py` valida; `persistencia.py` opera anuncios; `persistencia_fotos.py` operaciones de imágenes; `imagenes.py` procesa WebP; `almacenamiento.py` integra Storage; `cuentas.py`/`auth_proveedor.py` manejan cuentas; `persistencia_chat_cuentas.py` mensajes privados.
- Catálogo y perfiles son públicos; la publicación, fotografía, disponibilidad, retiro y mensajería dependen de **rol/participante/propiedad verificados**.
- El nombre visible es **fijo desde el registro** (V7.10), como el rol. No volver a añadir una ruta para cambiarlo por asumir que V7.6 describe la versión vigente.
- La administración con contraseña compartida y las rutas anónimas de chat fueron retiradas en V7.9. Los archivos `admin-v6` son componentes reaprovechados del vendedor, **no permisos globales**. El archivo de chat anónimo conserva historial de solo lectura.
- No reactivar `/api/admin/*`, escrituras anónimas, login compartido ni rutas obsoletas.

## 3. Seguridad y datos

- Credenciales solo en variables de entorno; `.env` ignorado. `SUPABASE_SECRET_KEY` o alternativa heredada `SUPABASE_SERVICE_ROLE_KEY` son exclusivamente de servidor. No exponer contraseñas, DSN, tokens ni secretos en logs, navegador, capturas o Git.
- **Toda mutación privada** debe comprobar sesión válida, CSRF, rol y propiedad/participación. No aceptar IDs de propietario desde el cliente ni confiar en la visibilidad de botones.
- Cookies seguras (HttpOnly/SameSite y Secure en HTTPS), revocación y respuestas privadas sin caché. Los destinos de retorno deben restringirse a URLs internas.
- Las publicaciones generan IDs en PostgreSQL y emplean UUID/idempotencia donde corresponda. Precios USD en centavos, máximo global de anuncios sujeto a las restricciones de persistencia.
- La placa es privada del propietario; el frontend público no debe exponerla. La imagen en Storage puede revelar visualmente una placa: revisar los archivos antes de subirlos.
- Booleanos opcionales son **triestado**: verdadero, falso o no especificado. No inferir campos nuevos de textos libres.
- Las tablas usan RLS y privilegios directos revocados para usuarios públicos. No abrir políticas para silenciar INFO.
- Preview Vercel **siempre** fuerza solo lectura, aunque `APP_READ_ONLY=false`. La auditoría V7.21 verificó esa protección localmente; no presupone un ensayo remoto de Preview.

## 4. Fotografías y consistencia

- Hasta cinco fotografías por vehículo. Originales JPEG/PNG/WebP ≤10.000.000 bytes; preparación de WebP en navegador ≤1600 px/≤1.000.000 bytes y validación/recodificación por Python; solicitud HTTP limitada.
- No guardar binarios en PostgreSQL ni depender del disco efímero de Vercel.
- Reservar ruta nueva de Storage y registrar la operación antes de escribir bytes; confirmar metadatos en PostgreSQL y **solo entonces** encolar limpieza de la referencia anterior.
- La cola de limpieza no autoriza por sí sola a borrar. La reclamación debe verificar bloqueos, reservas vencidas, referencias activas y concesión; un fallo mantiene trabajo recuperable.
- No ejecutar limpiezas, migraciones ni cargas masivas contra Supabase sin aprobación explícita y verificación de alcance. No emplear anuncios de otros usuarios como datos de prueba.

## 5. Pruebas y ambientes

- Mantener pruebas unitarias/Node y de integración según el README. Ejecutar la suite completa solo cuando el alcance lo justifique.
- Para pruebas PostgreSQL reales, usar `TEST_DATABASE_URL` apuntando a **loopback** y base de control `grupo7_test*`, con datos ficticios. La fixture crea bases desechables y debe rechazar destinos remotos. Sin esa variable, declarar **omitidas** las pruebas de integración, no aprobadas.
- Storage/Auth simulados **no** prueban servicios remotos. El informe V7.21 aprobó 28 tests localizados y 8 PostgreSQL aislados; no ejecutó escrituras reales de Production.
- Verificar sintaxis Python/JS, recursos estáticos, cambios de navegación y `git diff --check` cuando corresponda.
- En pruebas de navegador priorizar los tres recorridos académicos: visitante; comprador; vendedor. El cierre V7.21 se centró en Chromium 1920 × 1080. No extrapolar ese resultado a todos los dispositivos.
- Detener servidores/procesos temporales. Antes de borrar copias de PostgreSQL, comprobar que no son los clústeres originales; la auditoría dejó copias detenidas cuya eliminación recursiva estuvo bloqueada por el entorno.

## 6. Vercel y despliegues

- `app.py` expone la aplicación Flask; `.python-version` fija Python 3.14; `vercel.json` configura el despliegue.
- `scripts/preparar_vercel.py` sincroniza los archivos estáticos desde `static/` a `public/static/`. Confirmar que las copias sean iguales antes de un despliegue.
- Production pública estaba READY en el commit `336bf7f` durante la auditoría del 18-11-2026. Esa evidencia **no** garantiza futuras sesiones ni escrituras privadas.
- Mantener variables por ambiente. No publicar una Preview en modo escritura. No desplegar por el mero hecho de actualizar documentación.
- Para la presentación, validar los recorridos autenticados reales únicamente con cuentas y publicaciones de demostración autorizadas.

## 7. Política de cierre

El prototipo **ya cumple el alcance funcional acordado**. No añadir favoritos, red social, pagos, dashboards, reescrituras de lenguaje, nuevas dependencias ni rediseños cosméticos por iniciativa propia. Solo proponer una corrección si hay fallo reproducible de seguridad, integridad o recorrido esencial; documentar evidencia y pruebas.

Las fechas históricas de cierre/publicación/entrega están en [ROADMAP](docs/ROADMAP.md) y deben confirmarse con el equipo. No crear una automatización que retire el sitio sin petición expresa. No atribuir certificación, garantías comerciales o pruebas no realizadas al sistema.
