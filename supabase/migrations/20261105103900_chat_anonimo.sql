-- Mensajería comprador-anónimo / administración.
--
-- Aplicar únicamente en entornos autorizados. Las tablas no se exponen por
-- Supabase Data API: Flask es el único punto de acceso y usa credenciales de
-- servidor. No se almacenan tokens en claro; sesiones_visitante guarda solo
-- su SHA-256 hexadecimal.

CREATE TABLE public.visitantes_anonimos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id UUID UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON COLUMN public.visitantes_anonimos.auth_user_id IS
    'Reserva nullable para vincular posteriormente con auth.users; no se crea ni autentica ninguna cuenta en esta etapa.';

CREATE TABLE public.sesiones_visitante (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visitante_id UUID NOT NULL REFERENCES public.visitantes_anonimos(id) ON DELETE CASCADE,
    verificador CHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    CONSTRAINT sesiones_visitante_hash_valido CHECK (verificador ~ '^[0-9a-f]{64}$'),
    CONSTRAINT sesiones_visitante_expiracion_valida CHECK (expires_at > created_at),
    CONSTRAINT sesiones_visitante_revocacion_valida CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE INDEX sesiones_visitante_propietario_idx
    ON public.sesiones_visitante (visitante_id, expires_at DESC);
CREATE INDEX sesiones_visitante_expiracion_idx
    ON public.sesiones_visitante (expires_at) WHERE revoked_at IS NULL;

CREATE TABLE public.conversaciones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehiculo_id BIGINT NOT NULL REFERENCES public.vehiculos(id) ON DELETE RESTRICT,
    visitante_id UUID NOT NULL REFERENCES public.visitantes_anonimos(id) ON DELETE RESTRICT,
    estado VARCHAR(12) NOT NULL DEFAULT 'abierta',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT conversaciones_estado_valido CHECK (estado IN ('abierta', 'atendida')),
    CONSTRAINT conversaciones_vehiculo_visitante_unicos UNIQUE (vehiculo_id, visitante_id)
);
CREATE INDEX conversaciones_visitante_actualizadas_idx
    ON public.conversaciones (visitante_id, updated_at DESC, id DESC);
CREATE INDEX conversaciones_admin_actualizadas_idx
    ON public.conversaciones (estado, updated_at DESC, id DESC);

CREATE TABLE public.mensajes_chat (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conversacion_id UUID NOT NULL REFERENCES public.conversaciones(id) ON DELETE CASCADE,
    remitente VARCHAR(12) NOT NULL,
    contenido VARCHAR(4000) NOT NULL,
    clave_idempotencia UUID NOT NULL UNIQUE,
    huella_solicitud CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT mensajes_chat_remitente_valido CHECK (remitente IN ('comprador', 'administrador')),
    CONSTRAINT mensajes_chat_contenido_valido CHECK (
        char_length(btrim(contenido)) BETWEEN 1 AND 4000
    ),
    CONSTRAINT mensajes_chat_huella_valida CHECK (huella_solicitud ~ '^[0-9a-f]{64}$')
);
CREATE INDEX mensajes_chat_conversacion_cursor_idx
    ON public.mensajes_chat (conversacion_id, id);
CREATE INDEX mensajes_chat_recientes_comprador_idx
    ON public.mensajes_chat (created_at DESC)
    WHERE remitente = 'comprador';

-- Emisión de sesiones limitada por digest HMAC de origen, sin persistir IP.
-- Una sola fila por digest permite que el control sea atómico entre funciones.
CREATE TABLE public.chat_inicio_sesion_limites (
    clave_hash CHAR(64) PRIMARY KEY,
    ventana_desde TIMESTAMPTZ NOT NULL,
    intentos SMALLINT NOT NULL CHECK (intentos BETWEEN 1 AND 21),
    CONSTRAINT chat_inicio_sesion_hash_valido CHECK (clave_hash ~ '^[0-9a-f]{64}$')
);
CREATE INDEX chat_inicio_sesion_ventana_idx
    ON public.chat_inicio_sesion_limites (ventana_desde);

ALTER TABLE public.visitantes_anonimos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sesiones_visitante ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mensajes_chat ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_inicio_sesion_limites ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.visitantes_anonimos,
    public.sesiones_visitante, public.conversaciones, public.mensajes_chat,
    public.chat_inicio_sesion_limites
    FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON SEQUENCE public.mensajes_chat_id_seq
    FROM PUBLIC, anon, authenticated;

-- Reversión manual (ejecutar en orden inverso y solo si se autorizó este DDL):
-- DROP TABLE IF EXISTS public.mensajes_chat;
-- DROP TABLE IF EXISTS public.chat_inicio_sesion_limites;
-- DROP TABLE IF EXISTS public.conversaciones;
-- DROP TABLE IF EXISTS public.sesiones_visitante;
-- DROP TABLE IF EXISTS public.visitantes_anonimos;
