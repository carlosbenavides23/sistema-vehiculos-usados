-- Extiende la ficha técnica sin exigir datos nuevos a las publicaciones existentes.
ALTER TABLE public.vehiculos
    ADD COLUMN version VARCHAR(40),
    ADD COLUMN motor VARCHAR(60),
    ADD COLUMN numero_puertas SMALLINT,
    ADD COLUMN capacidad_pasajeros SMALLINT,
    ADD COLUMN camara_reversa BOOLEAN,
    ADD COLUMN bluetooth BOOLEAN,
    ADD CONSTRAINT vehiculos_numero_puertas_valido
        CHECK (numero_puertas IS NULL OR numero_puertas BETWEEN 1 AND 10),
    ADD CONSTRAINT vehiculos_capacidad_pasajeros_valida
        CHECK (capacidad_pasajeros IS NULL OR capacidad_pasajeros BETWEEN 1 AND 100);

COMMENT ON COLUMN public.vehiculos.version IS
    'Versión o nivel de equipamiento declarado para la publicación; NULL si se desconoce.';
COMMENT ON COLUMN public.vehiculos.motor IS
    'Descripción breve del motor declarada para la publicación; no constituye certificación técnica.';
COMMENT ON COLUMN public.vehiculos.numero_puertas IS
    'Cantidad de puertas informada; NULL significa no especificado.';
COMMENT ON COLUMN public.vehiculos.capacidad_pasajeros IS
    'Capacidad de pasajeros informada; admite configuraciones de 1 a 100.';
COMMENT ON COLUMN public.vehiculos.camara_reversa IS
    'TRUE: sí; FALSE: no; NULL: no especificado.';
COMMENT ON COLUMN public.vehiculos.bluetooth IS
    'TRUE: sí; FALSE: no; NULL: no especificado.';

-- Normaliza únicamente equivalencias inequívocas. Las categorías históricas que
-- no figuran aquí se conservan literalmente y la aplicación permite editarlas
-- sin cambio hasta que una persona seleccione una categoría nueva.
UPDATE public.vehiculos
SET tipo_vehiculo = CASE lower(btrim(tipo_vehiculo))
    WHEN 'sedan' THEN 'sedan'
    WHEN 'sedán' THEN 'sedan'
    WHEN 'hatchback' THEN 'hatchback'
    WHEN 'hatch back' THEN 'hatchback'
    WHEN 'suv' THEN 'suv'
    WHEN 'sport utility vehicle' THEN 'suv'
    WHEN 'pickup' THEN 'pickup'
    WHEN 'pick-up' THEN 'pickup'
    WHEN 'coupe' THEN 'coupe'
    WHEN 'coupé' THEN 'coupe'
    WHEN 'convertible' THEN 'convertible'
    WHEN 'cabriolet' THEN 'convertible'
    WHEN 'minivan' THEN 'minivan'
    WHEN 'mini van' THEN 'minivan'
    WHEN 'van' THEN 'van_microbus'
    WHEN 'microbus' THEN 'van_microbus'
    WHEN 'microbús' THEN 'van_microbus'
    WHEN 'van microbus' THEN 'van_microbus'
    WHEN 'van / microbús' THEN 'van_microbus'
    WHEN 'camioneta' THEN 'camioneta'
    WHEN 'todoterreno' THEN 'todoterreno'
    WHEN 'todo terreno' THEN 'todoterreno'
    WHEN 'camion' THEN 'camion'
    WHEN 'camión' THEN 'camion'
    WHEN 'otro' THEN 'otro'
END
WHERE lower(btrim(tipo_vehiculo)) IN (
    'sedan', 'sedán', 'hatchback', 'hatch back', 'suv',
    'sport utility vehicle', 'pickup', 'pick-up', 'coupe', 'coupé',
    'convertible', 'cabriolet', 'minivan', 'mini van', 'van',
    'microbus', 'microbús', 'van microbus', 'van / microbús',
    'camioneta', 'todoterreno', 'todo terreno', 'camion', 'camión', 'otro'
);
