-- Cambios aditivos: conserva anuncios y fotografías existentes.
-- Flask es el único cliente de estas tablas de coordinación privadas.
CREATE TABLE public.admin_login_intentos (
    clave VARCHAR(128) PRIMARY KEY,
    intentos INTEGER NOT NULL CHECK (intentos >= 1),
    expira_en TIMESTAMPTZ NOT NULL,
    CHECK (char_length(clave) BETWEEN 1 AND 128)
);
COMMENT ON TABLE public.admin_login_intentos IS
    'Ventanas de intentos de acceso compartidas entre procesos. La clave se deriva mediante HMAC, sin guardar la IP.';
CREATE INDEX admin_login_intentos_expira_idx ON public.admin_login_intentos (expira_en);

CREATE TABLE public.solicitudes_idempotentes (
    clave UUID PRIMARY KEY,
    huella CHAR(64) NOT NULL CHECK (huella ~ '^[0-9a-f]{64}$'),
    vehiculo_id BIGINT NOT NULL REFERENCES public.vehiculos(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.solicitudes_idempotentes IS
    'Altas de anuncios idempotentes: una clave UUID no puede crear dos registros ni aceptar cuerpos diferentes.';
CREATE INDEX solicitudes_idempotentes_vehiculo_idx ON public.solicitudes_idempotentes (vehiculo_id);

CREATE TABLE public.fotografia_operaciones (
    clave UUID PRIMARY KEY,
    vehiculo_id BIGINT NOT NULL REFERENCES public.vehiculos(id) ON DELETE RESTRICT,
    fotografia_objetivo BIGINT,
    fotografia_resultado BIGINT,
    anterior_path TEXT,
    storage_path TEXT NOT NULL UNIQUE,
    huella CHAR(64) NOT NULL CHECK (huella ~ '^[0-9a-f]{64}$'),
    estado VARCHAR(12) NOT NULL DEFAULT 'pendiente'
        CHECK (estado IN ('pendiente', 'completada', 'cancelada')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (storage_path ~ '^[1-9][0-9]*/[0-9a-f]{32}\.webp$')
);
CREATE INDEX fotografia_operaciones_vehiculo_idx
    ON public.fotografia_operaciones (vehiculo_id, created_at);
COMMENT ON TABLE public.fotografia_operaciones IS
    'Reserva durable previa a la subida. Permite reintentos seguros y recuperar objetos tras fallos entre Storage y PostgreSQL.';

CREATE TABLE public.storage_limpieza (
    storage_path TEXT PRIMARY KEY,
    disponible_desde TIMESTAMPTZ NOT NULL DEFAULT now(),
    reclamada_hasta TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (char_length(storage_path) > 0)
);
CREATE INDEX storage_limpieza_pendiente_idx ON public.storage_limpieza (disponible_desde);
COMMENT ON TABLE public.storage_limpieza IS
    'Outbox durable: nunca se limpia una ruta referenciada. La foto anterior se encola solo después de confirmar su sustitución.';

ALTER TABLE public.admin_login_intentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solicitudes_idempotentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fotografia_operaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storage_limpieza ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_login_intentos, public.solicitudes_idempotentes,
    public.fotografia_operaciones, public.storage_limpieza
    FROM PUBLIC, anon, authenticated;
