# Evolución del Sistema de Vehículos Usados

**Proyecto académico:** Grupo 7 · Programación Estructurada · UAM Managua.  
**Periodo documentado:** octubre–18 de noviembre de 2026.  
**Punto de llegada:** código V7.20.5 (PR #50, commit `336bf7f`), auditado como V7.21 (**APTO CON OBSERVACIONES**).

Esta crónica resume decisiones y transformaciones funcionales respaldadas por documentos versionados y el historial de pull requests. No sustituye los informes específicos de cada versión ni atribuye pruebas remotas a versiones que solo se validaron localmente.

## 1. De la idea inicial al catálogo compartido

El objetivo académico inicial era registrar, modificar y consultar vehículos usados diferenciando a quien publica del comprador que consulta. El segundo avance utilizó **`localStorage` en el navegador**, útil para demostrar formularios y navegación, pero no como repositorio común de anuncios.

La primera transformación decisiva fue sustituir la persistencia local por **PostgreSQL 17**, exponer consultas y escrituras mediante **Flask** y trasladar fotografías a **Supabase Storage**. El PR [#1](https://github.com/carlosbenavides23/sistema-vehiculos-usados/pull/1) incorporó acceso con psycopg, migraciones, validaciones, sesiones administrativas iniciales, CSRF, idempotencia y recuperación de fallos fotográficos. La adaptación a **Vercel** exigió después resolver el empaquetado de recursos estáticos (PR [#2](https://github.com/carlosbenavides23/sistema-vehiculos-usados/pull/2) y [#3](https://github.com/carlosbenavides23/sistema-vehiculos-usados/pull/3)).

**Aprendizaje técnico:** el navegador dejó de ser la fuente de verdad. Las publicaciones pasaron a ser compartidas y verificadas por el servidor; las fotos se almacenaron como objetos, no como datos binarios en PostgreSQL.

## 2. Catálogo, búsqueda e interfaz de demostración

Los PR [#4](https://github.com/carlosbenavides23/sistema-vehiculos-usados/pull/4) a [#7](https://github.com/carlosbenavides23/sistema-vehiculos-usados/pull/7) ampliaron el catálogo con búsquedas, filtros, fichas accesibles e importación controlada de datos. Las versiones visuales **V5/V6** consolidaron fichas, panel e interfaz responsive; la llegada del chat anónimo inicial (PR [#8](https://github.com/carlosbenavides23/sistema-vehiculos-usados/pull/8)) permitió comprobar la relación entre un anuncio y la conversación.

Las iteraciones de la etapa V6 se centraron en consistencia visual, accesibilidad, iconografía, microinteracciones, fotografías, borradores, disponibilidad y retiro de publicaciones (aproximadamente PR #9–#19). No todos esos cambios ampliaron el modelo de negocio: una parte considerable fue **corregir el uso real de flujos ya existentes**.

La administración inicial era global y se autenticaba mediante contraseña compartida. El chat de compradores era anónimo. Ambas decisiones pertenecen a la historia del prototipo y serían reemplazadas en V7.

## 3. V7: transición a compradores y vendedores reales

| Hito | Cambio de fondo | Referencia |
| --- | --- | --- |
| **V7.1** | Registro y acceso de compradores/vendedores con Supabase Auth, roles persistidos y sesiones verificables. | [PR #20](https://github.com/carlosbenavides23/sistema-vehiculos-usados/pull/20) |
| **V7.2** | Propiedad individual de vehículos y fotografías; cada vendedor opera solo sobre su inventario. | [PR #21](https://github.com/carlosbenavides23/sistema-vehiculos-usados/pull/21) |
| **V7.3** | Conversaciones privadas autenticadas, asociadas a vehículo, comprador y vendedor. | [PR #22](https://github.com/carlosbenavides23/sistema-vehiculos-usados/pull/22) |
| **V7.4** | Activación controlada por entorno y barrera de solo lectura para Preview. | [PR #23](https://github.com/carlosbenavides23/sistema-vehiculos-usados/pull/23) |
| **V7.5–V7.6** | Mejoras de registro y acceso; incorporación de nombres visibles a perfiles y conversaciones. En V7.6 todavía se podía editar el nombre. | [PR #24](https://github.com/carlosbenavides23/sistema-vehiculos-usados/pull/24), [#25](https://github.com/carlosbenavides23/sistema-vehiculos-usados/pull/25) |
| **V7.7** | Ficha técnica ampliada, nuevas características y categorías normalizadas. | [PR #26](https://github.com/carlosbenavides23/sistema-vehiculos-usados/pull/26) |
| **V7.8** | Preparación de una transferencia controlada del inventario heredado a una cuenta propietaria. | [PR #27](https://github.com/carlosbenavides23/sistema-vehiculos-usados/pull/27) |
| **V7.9** | Retiro de la administración compartida y de las escrituras anónimas; conservación del archivo histórico bajo permisos del vendedor. | [PR #28](https://github.com/carlosbenavides23/sistema-vehiculos-usados/pull/28) |
| **V7.10** | Nombre visible fijado al registrarse, sin edición posterior. | [PR #29](https://github.com/carlosbenavides23/sistema-vehiculos-usados/pull/29) |

### Por qué V7 fue un cambio arquitectónico

El paso importante no fue añadir una pantalla de registro, sino sustituir un **administrador compartido** por **propiedad verificable por vendedor**. Desde entonces, el servidor debe comprobar la identidad, el rol, el dueño del vehículo y el acceso a cada conversación. Esto afectó inventarios, fotografías, sesiones, archivos históricos y pruebas. El chat dejó de depender de la identidad anónima anterior.

La decisión de fijar el nombre visible en V7.10 es deliberada: evita una función de renombrado innecesaria para la demostración académica, aunque la base histórica conserve documentos de V7.6 donde editar el nombre era posible.

## 4. V7.11–V7.20.5: consolidación de experiencia y navegación

Después de cerrar la identidad, las últimas iteraciones buscaron que los recorridos se entendieran **sin conocimientos del funcionamiento interno**:

| Versión | Evolución | Referencias |
| --- | --- | --- |
| **V7.11–V7.12** | Mejora del panel vendedor, bandejas, accesibilidad y flujos de catálogo/cuenta. | [PR #30](https://github.com/carlosbenavides23/sistema-vehiculos-usados/pull/30), [#32](https://github.com/carlosbenavides23/sistema-vehiculos-usados/pull/32) |
| **V7.13** | Continuidad al volver de inventario a fichas, contacto tras login y mensajes por teclado. | [PR #33](https://github.com/carlosbenavides23/sistema-vehiculos-usados/pull/33) |
| **V7.14** | Perfiles públicos de vendedores; consulta de otras publicaciones y retorno contextual. | [PR #34](https://github.com/carlosbenavides23/sistema-vehiculos-usados/pull/34) |
| **V7.15** | Formulario más comprensible para publicar, legibilidad y secuencia explícita de fotografías. | [PR #35](https://github.com/carlosbenavides23/sistema-vehiculos-usados/pull/35) |
| **V7.16–V7.17** | Identidad coherente en navegación y rediseño de perfiles y controles de galería. | [PR #36](https://github.com/carlosbenavides23/sistema-vehiculos-usados/pull/36)–[#40](https://github.com/carlosbenavides23/sistema-vehiculos-usados/pull/40) |
| **V7.18** | Lectura y jerarquía de las tarjetas de conversaciones del vendedor. | [PR #41](https://github.com/carlosbenavides23/sistema-vehiculos-usados/pull/41) |
| **V7.19–V7.19.2** | Ficha de vehículo: jerarquía de información, encuadre y tamaño de fotografías. | [PR #42](https://github.com/carlosbenavides23/sistema-vehiculos-usados/pull/42)–[#44](https://github.com/carlosbenavides23/sistema-vehiculos-usados/pull/44) |
| **V7.20** | Galería protagonista, miniaturas desplazables y panel lateral de precio/contacto. | [PR #45](https://github.com/carlosbenavides23/sistema-vehiculos-usados/pull/45) |
| **V7.20.1–V7.20.4** | Tarjetas de chat comprador y transiciones correctas de login, panel y retorno al catálogo. | [PR #46](https://github.com/carlosbenavides23/sistema-vehiculos-usados/pull/46)–[#49](https://github.com/carlosbenavides23/sistema-vehiculos-usados/pull/49) |
| **V7.20.5** | Se elimina el segundo icono de visibilidad de contraseña en Edge, conservando el control accesible propio. | [PR #50](https://github.com/carlosbenavides23/sistema-vehiculos-usados/pull/50) |

Esta fase muestra un cambio de prioridad: de **añadir capacidades** a **pulir la continuidad, la claridad y las regresiones**. El ajuste del icono de contraseña no modificó la arquitectura; sí cerró un defecto visible y comprobado en varios navegadores.

## 5. V7.21: auditoría integral de aceptación

El 18 de noviembre de 2026 se auditó `main` en `336bf7f` con Chromium a **1920 × 1080**. Se verificaron en Production, **solo en lectura pública**, la disponibilidad, recursos estáticos, una búsqueda, ficha con WebP y perfil del vendedor; Vercel reportó READY para ese commit.

En local, con PostgreSQL 17 aislado y dobles de Auth/Storage, se completaron los recorridos de comprador y vendedor y se aprobaron **28 pruebas localizadas y 8 pruebas con PostgreSQL**. Se cubrieron propiedad, CSRF, sesiones, idempotencia, fotografía, retiro y escenarios de concurrencia.

**Resultado: APTO CON OBSERVACIONES.** No se confirmaron defectos P0/P1 ni P2/P3 en los recorridos evaluados. Queda **sin verificar en esa auditoría** el recorrido autenticado completo contra los servicios reales de Production. La verificación local del modo solo lectura no equivale a un ensayo de un Preview remoto real.

El informe [`auditoria-final-v721.md`](auditoria-final-v721.md) conserva la matriz de aceptación y los límites de la evidencia.

## 6. Cambios de arquitectura a lo largo del proyecto

| Aspecto | Etapa inicial | Etapa final |
| --- | --- | --- |
| Persistencia | Datos en `localStorage` | PostgreSQL compartido, datos verificados en servidor |
| Imágenes | Prototipo de catálogo | Objetos WebP en Storage, metadatos transaccionales y limpieza recuperable |
| Acceso de publicación | Administrador global | Vendedores con propiedad individual y Auth |
| Comprador | Visitante anónimo | Cuenta compradora, conversaciones privadas y retorno contextual |
| Mensajería | Primer chat anónimo | Chat autenticado por participantes; histórico anónimo solo lectura |
| Interfaz | Formulario y consulta | Catálogo, fichas ricas, galería, perfiles y panel vendedor |
| Pruebas | Validaciones funcionales iniciales | Suites dirigidas, PostgreSQL aislado y recorridos con navegador |
| Despliegue | Preparación Flask/Vercel | Producción pública verificada para consulta en commit `336bf7f` |

## 7. Qué se aprendió y por qué se detuvo el desarrollo

- **Persistencia y roles primero:** un catálogo compartido exige autoridad del servidor y trazabilidad de propietarios.
- **Las operaciones concurrentes importan:** el almacenamiento de fotos y los mensajes deben resistir reintentos y fallos parciales.
- **La navegación es parte del comportamiento:** regresar a una ficha o recuperar una conversación puede ser tan importante para la demostración como una función CRUD.
- **La auditoría delimita lo probado:** un doble de Auth/Storage no demuestra la integración remota, aunque PostgreSQL sea real en una prueba local.
- **Evitar expansión de alcance:** pagos, funciones sociales, moderación comercial o una reescritura tecnológica no eran necesarios para cumplir el objetivo educativo.

El cierre funcional significa que **ya no se consideran necesarias nuevas funcionalidades** para el prototipo. La preparación de cuentas, datos, documentación y presentación continúa como trabajo de entrega, no como una nueva versión del producto.

## 8. Fuentes dentro del repositorio

- [Estado actual](ESTADO_ACTUAL.md).
- [Auditoría final V7.21](auditoria-final-v721.md).
- [Arquitectura y decisiones](ARQUITECTURA.md) · [DECISIONES](DECISIONES.md).
- [Avances académicos](AVANCE_02.md), [AVANCE_03](AVANCE_03.md), [AVANCE_04](AVANCE_04.md).
- Historial de [pull requests #1–#50](https://github.com/carlosbenavides23/sistema-vehiculos-usados/pulls?q=is%3Apr).
