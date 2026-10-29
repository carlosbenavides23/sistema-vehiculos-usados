-- Esquema inicial de persistencia para el catálogo del Grupo 7.
-- Las lecturas y escrituras del sitio pasan por Flask; no se concede acceso
-- directo a las tablas a los roles públicos de la API de Supabase.

CREATE TABLE public.vehiculos (
    id BIGINT GENERATED ALWAYS AS IDENTITY,
    marca VARCHAR(60) NOT NULL,
    modelo VARCHAR(60) NOT NULL,
    anio SMALLINT NOT NULL,
    kilometraje BIGINT NOT NULL,
    precio_centavos BIGINT NOT NULL,
    ubicacion VARCHAR(100) NOT NULL,
    descripcion VARCHAR(1000) NOT NULL,
    disponibilidad VARCHAR(12) NOT NULL DEFAULT 'disponible',
    color VARCHAR(40),
    placa VARCHAR(20),
    tipo_vehiculo VARCHAR(40),
    transmision VARCHAR(30),
    combustible VARCHAR(30),
    aire_acondicionado BOOLEAN,
    ventanas_electricas BOOLEAN,
    pantalla_multimedia BOOLEAN,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT vehiculos_pkey PRIMARY KEY (id),
    CONSTRAINT vehiculos_id_javascript_safe CHECK (
        id BETWEEN 1 AND 9007199254740991
    ),
    CONSTRAINT vehiculos_marca_no_vacia CHECK (char_length(btrim(marca)) >= 1),
    CONSTRAINT vehiculos_modelo_no_vacio CHECK (char_length(btrim(modelo)) >= 1),
    CONSTRAINT vehiculos_anio_valido CHECK (anio >= 1900),
    CONSTRAINT vehiculos_kilometraje_valido CHECK (
        kilometraje BETWEEN 0 AND 9007199254740991
    ),
    CONSTRAINT vehiculos_precio_valido CHECK (
        precio_centavos BETWEEN 1 AND 9007199254740991
    ),
    CONSTRAINT vehiculos_ubicacion_no_vacia CHECK (
        char_length(btrim(ubicacion)) BETWEEN 1 AND 100
    ),
    CONSTRAINT vehiculos_descripcion_valida CHECK (
        char_length(btrim(descripcion)) BETWEEN 10 AND 1000
    ),
    CONSTRAINT vehiculos_disponibilidad_valida CHECK (
        disponibilidad IN ('disponible', 'vendido')
    )
);

COMMENT ON TABLE public.vehiculos IS
    'Anuncios de vehículos usados; las reglas dinámicas de año y normalización también se validan en Python.';
COMMENT ON COLUMN public.vehiculos.precio_centavos IS
    'Precio en centavos de USD, compatible con el formato del segundo avance.';
COMMENT ON COLUMN public.vehiculos.aire_acondicionado IS
    'TRUE: sí; FALSE: no; NULL: no especificado.';
COMMENT ON COLUMN public.vehiculos.ventanas_electricas IS
    'TRUE: sí; FALSE: no; NULL: no especificado.';
COMMENT ON COLUMN public.vehiculos.pantalla_multimedia IS
    'TRUE: sí; FALSE: no; NULL: no especificado.';

CREATE TABLE public.vehiculo_fotografias (
    id BIGINT GENERATED ALWAYS AS IDENTITY,
    vehiculo_id BIGINT NOT NULL,
    storage_path TEXT NOT NULL,
    orden SMALLINT NOT NULL,
    mime_type VARCHAR(30) NOT NULL,
    size_bytes INTEGER NOT NULL,
    width_px SMALLINT NOT NULL,
    height_px SMALLINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT vehiculo_fotografias_pkey PRIMARY KEY (id),
    CONSTRAINT vehiculo_fotografias_id_javascript_safe CHECK (
        id BETWEEN 1 AND 9007199254740991
    ),
    CONSTRAINT vehiculo_fotografias_vehiculo_fkey
        FOREIGN KEY (vehiculo_id)
        REFERENCES public.vehiculos (id)
        ON DELETE RESTRICT,
    CONSTRAINT vehiculo_fotografias_ruta_no_vacia CHECK (
        char_length(btrim(storage_path)) >= 1
    ),
    CONSTRAINT vehiculo_fotografias_orden_valido CHECK (orden BETWEEN 1 AND 5),
    CONSTRAINT vehiculo_fotografias_mime_valido CHECK (mime_type = 'image/webp'),
    CONSTRAINT vehiculo_fotografias_tamano_valido CHECK (
        size_bytes BETWEEN 1 AND 1000000
    ),
    CONSTRAINT vehiculo_fotografias_ancho_valido CHECK (width_px BETWEEN 1 AND 1600),
    CONSTRAINT vehiculo_fotografias_alto_valido CHECK (height_px BETWEEN 1 AND 1600),
    CONSTRAINT vehiculo_fotografias_ruta_unica UNIQUE (storage_path),
    CONSTRAINT vehiculo_fotografias_orden_unico UNIQUE (vehiculo_id, orden)
);

COMMENT ON TABLE public.vehiculo_fotografias IS
    'Metadatos de fotos futuras; los objetos se guardarán en Supabase Storage, no en PostgreSQL.';
COMMENT ON COLUMN public.vehiculo_fotografias.storage_path IS
    'Ruta relativa única del objeto dentro del bucket de Storage.';

-- RLS queda habilitado sin políticas de acceso directo. El catálogo público
-- y las operaciones administrativas se servirán exclusivamente desde Flask.
ALTER TABLE public.vehiculos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehiculo_fotografias ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.vehiculos
    FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.vehiculo_fotografias
    FROM PUBLIC, anon, authenticated;

-- Las secuencias de identidad tampoco deben ser manipulables desde la API.
REVOKE ALL PRIVILEGES ON SEQUENCE public.vehiculos_id_seq
    FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON SEQUENCE public.vehiculo_fotografias_id_seq
    FROM PUBLIC, anon, authenticated;
