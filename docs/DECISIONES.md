# Decisiones y cuestiones pendientes

## Aceptadas para este avance

| Decisión | Justificación |
| --- | --- |
| Python, Flask y funciones en pocos módulos | Cumplir Programación Estructurada, mantener reglas comprobables y código explicable por estudiantes |
| HTML, CSS y JavaScript sin frameworks | Suficiente para listado y formulario; no requiere compilación |
| Estado versionado solo en `localStorage` | Persistencia provisional exigida, sin base de datos ni colección global de Flask |
| Validar toda la colección en Python en cada operación | El navegador puede alterarse; no confiar en tipos, IDs ni formato |
| IDs numéricos y dinero en centavos | Identidad estable y cálculos monetarios sin errores binarios |
| Estado incompatible bloquea operaciones; restauración confirmada | Evitar pérdida silenciosa de los datos anteriores |
| Seis vehículos y SVG local | Demostración coherente sin fotografías, datos o servicios externos |
| Límite de 500 registros y una pestaña de trabajo | Acotar el estado de un prototipo sin resolución de concurrencia |
| Descripciones completas y tipografía legible desde 320 px | Mostrar la información del anuncio sin recortarla; adaptar tarjetas y formulario sin agregar pantallas ni bibliotecas |

## Suposiciones reversibles

- **USD** para los precios de demostración; no es un requisito confirmado del profesor. La moneda está indicada en interfaz y documentación.
- Vendedor ficticio fijo, sin identidad real ni cuentas. Los contactos de demostración no deben enlazar a personas reales.
- Ubicación general como texto; no dirección precisa ni geolocalización.
- Descripción de 10 a 1000 caracteres y marca/modelo hasta 60: límites de interfaz y validación elegidos para este prototipo.
- La rama inicial es `main`; no se crea un remoto ni se publica el repositorio.

## Indicaciones del profesor

Se hace explícito el uso de Python. Se conserva **precio de venta** como dato del anuncio y se excluye el filtro de precio máximo.

**“Poner números”** es ambiguo: no se interpreta como una funcionalidad confirmada. Se usan números para ID, año, kilometraje y precio; falta aclarar si el docente se refiere a numeración de requisitos, pantallas u otra cosa.

**Validación de entradas** comprueba campos del formulario y estructura del estado para que el programa funcione. **Validación técnica del vehículo** sería una función distinta, futura: faltan responsable, criterios, evidencia y efecto del resultado. No se ha confirmado un rol de mecánico, un flujo de aprobación ni certificación oficial; no se implementan ni se muestran como reales.

## Por resolver

1. Confirmar significado de “poner números” con el docente.
2. Definir alcance, responsable, criterios y evidencia de la validación técnica del vehículo.
3. Elegir persistencia definitiva y su relación con usuarios/dispositivos antes de ampliar el sistema.
4. Precisar contacto e integración, privacidad y servicios autorizados para otra etapa.
5. Confirmar las fechas de presentación restantes, manteniendo la fecha límite total del **30 de noviembre de 2026**.

Toda modificación de una decisión debe actualizar este archivo, el contrato y las instrucciones afectadas antes de ampliar el alcance.
