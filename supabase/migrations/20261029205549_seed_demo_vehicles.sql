-- Conjunto inicial ficticio. Solo se inserta cuando el catálogo está vacío;
-- los IDs se generan con IDENTITY y las características no se infieren de la descripción.
INSERT INTO public.vehiculos (
    marca,
    modelo,
    anio,
    kilometraje,
    precio_centavos,
    ubicacion,
    descripcion,
    disponibilidad
)
SELECT
    demo.marca,
    demo.modelo,
    demo.anio,
    demo.kilometraje,
    demo.precio_centavos,
    demo.ubicacion,
    demo.descripcion,
    demo.disponibilidad
FROM (
    VALUES
        ('Toyota', 'Corolla', 2021, 42000, 1680000, 'Managua, Nicaragua', 'Sedán automático, aire acondicionado y cámara de retroceso. Un vehículo cómodo para el día a día.', 'disponible'),
        ('Hyundai', 'Tucson', 2020, 58000, 2150000, 'Masaya, Nicaragua', 'SUV automática con amplio espacio interior, pantalla central y asientos de tela. Ideal para viajes en familia.', 'disponible'),
        ('Suzuki', 'Swift', 2022, 28000, 1390000, 'León, Nicaragua', 'Compacto de transmisión manual, cinco puertas y aire acondicionado. Práctico para recorrer la ciudad.', 'disponible'),
        ('Nissan', 'Frontier', 2019, 86000, 2475000, 'Estelí, Nicaragua', 'Pickup de doble cabina con transmisión manual y amplio espacio de carga. Interior cómodo y funcional.', 'disponible'),
        ('Kia', 'Rio', 2021, 39000, 1420000, 'Granada, Nicaragua', 'Sedán automático con conectividad Bluetooth, dirección asistida y aire acondicionado. Color gris plata.', 'vendido'),
        ('Honda', 'CR-V', 2020, 64000, 2290000, 'Managua, Nicaragua', 'SUV automática de cinco plazas con cámara de retroceso y maletero amplio. Una opción versátil y espaciosa.', 'disponible')
) AS demo(marca, modelo, anio, kilometraje, precio_centavos, ubicacion, descripcion, disponibilidad)
WHERE NOT EXISTS (SELECT 1 FROM public.vehiculos);
