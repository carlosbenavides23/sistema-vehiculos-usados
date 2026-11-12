-- V7.3.1: conversaciones privadas entre compradores y vendedores autenticados.
-- Modelo aditivo: el chat anónimo existente permanece intacto durante la
-- transición. Aplicar después de V7.1 y V7.2.

CREATE TABLE public.conversaciones_cuentas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comprador_id UUID NOT NULL REFERENCES public.roles_usuarios(usuario_id) ON DELETE RESTRICT,
    vehiculo_id BIGINT NOT NULL REFERENCES public.vehiculos(id) ON DELETE RESTRICT,
    estado VARCHAR(12) NOT NULL DEFAULT 'abierta',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT conversaciones_cuentas_estado_valido CHECK (estado IN ('abierta', 'atendida')),
    CONSTRAINT conversaciones_cuentas_comprador_vehiculo_unicos UNIQUE (comprador_id, vehiculo_id)
);
CREATE INDEX conversaciones_cuentas_comprador_actualizadas_idx
    ON public.conversaciones_cuentas (comprador_id, updated_at DESC, id DESC);
CREATE INDEX conversaciones_cuentas_vehiculo_actualizadas_idx
    ON public.conversaciones_cuentas (vehiculo_id, updated_at DESC, id DESC);

CREATE TABLE public.mensajes_chat_cuentas (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conversacion_id UUID NOT NULL REFERENCES public.conversaciones_cuentas(id) ON DELETE CASCADE,
    autor_id UUID NOT NULL REFERENCES public.roles_usuarios(usuario_id) ON DELETE RESTRICT,
    remitente VARCHAR(12) NOT NULL,
    contenido VARCHAR(4000) NOT NULL,
    clave_idempotencia UUID NOT NULL UNIQUE,
    huella_solicitud CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT mensajes_chat_cuentas_remitente_valido CHECK (remitente IN ('comprador', 'vendedor')),
    CONSTRAINT mensajes_chat_cuentas_contenido_valido CHECK (
        char_length(btrim(contenido)) BETWEEN 1 AND 4000
    ),
    CONSTRAINT mensajes_chat_cuentas_huella_valida CHECK (huella_solicitud ~ '^[0-9a-f]{64}$')
);
CREATE INDEX mensajes_chat_cuentas_conversacion_cursor_idx
    ON public.mensajes_chat_cuentas (conversacion_id, id);
CREATE INDEX mensajes_chat_cuentas_recientes_comprador_idx
    ON public.mensajes_chat_cuentas (created_at DESC)
    WHERE remitente = 'comprador';

-- La fila del vehículo se bloquea durante la creación. El mismo bloqueo lo
-- toma V6.5.4 al retirar una publicación, serializando ambas operaciones.
CREATE OR REPLACE FUNCTION public.v73_validar_conversacion_cuenta()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
    rol_comprador text;
    propietario uuid;
    retiro timestamptz;
BEGIN
    IF TG_OP = 'UPDATE'
       AND (NEW.comprador_id IS DISTINCT FROM OLD.comprador_id
            OR NEW.vehiculo_id IS DISTINCT FROM OLD.vehiculo_id) THEN
        RAISE EXCEPTION 'La identidad de la conversación no puede cambiar'
            USING ERRCODE = '23514';
    END IF;

    SELECT r.rol INTO rol_comprador
      FROM public.roles_usuarios AS r
      WHERE r.usuario_id = NEW.comprador_id FOR KEY SHARE;
    IF rol_comprador IS DISTINCT FROM 'comprador' THEN
        RAISE EXCEPTION 'La conversación requiere una cuenta compradora válida'
            USING ERRCODE = '23514';
    END IF;

    SELECT v.vendedor_id, v.retirado_en INTO propietario, retiro
      FROM public.vehiculos AS v
      WHERE v.id = NEW.vehiculo_id FOR UPDATE;
    IF NOT FOUND OR propietario IS NULL OR retiro IS NOT NULL THEN
        RAISE EXCEPTION 'El vehículo no admite nuevas conversaciones'
            USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.roles_usuarios AS r
        WHERE r.usuario_id = propietario AND r.rol = 'vendedor'
    ) THEN
        RAISE EXCEPTION 'El vehículo no tiene un vendedor válido'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.v73_validar_conversacion_cuenta() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER v73_conversacion_cuenta_validar
    BEFORE INSERT OR UPDATE OF comprador_id, vehiculo_id
    ON public.conversaciones_cuentas
    FOR EACH ROW EXECUTE FUNCTION public.v73_validar_conversacion_cuenta();

-- El autor y el sentido del mensaje se derivan de la conversación y del
-- propietario persistido; nunca del nombre o ID recibido por el navegador.
CREATE OR REPLACE FUNCTION public.v73_validar_mensaje_cuenta()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
    comprador uuid;
    vendedor uuid;
    rol_autor text;
BEGIN
    SELECT c.comprador_id, v.vendedor_id INTO comprador, vendedor
      FROM public.conversaciones_cuentas AS c
      JOIN public.vehiculos AS v ON v.id = c.vehiculo_id
      WHERE c.id = NEW.conversacion_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'La conversación no existe' USING ERRCODE = '23503';
    END IF;
    SELECT r.rol INTO rol_autor FROM public.roles_usuarios AS r
      WHERE r.usuario_id = NEW.autor_id;
    IF (NEW.remitente = 'comprador' AND
        (NEW.autor_id IS DISTINCT FROM comprador OR rol_autor IS DISTINCT FROM 'comprador'))
       OR (NEW.remitente = 'vendedor' AND
        (NEW.autor_id IS DISTINCT FROM vendedor OR rol_autor IS DISTINCT FROM 'vendedor')) THEN
        RAISE EXCEPTION 'El autor no participa en la conversación'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.v73_validar_mensaje_cuenta() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER v73_mensaje_cuenta_validar
    BEFORE INSERT OR UPDATE OF conversacion_id, autor_id, remitente
    ON public.mensajes_chat_cuentas
    FOR EACH ROW EXECUTE FUNCTION public.v73_validar_mensaje_cuenta();

ALTER TABLE public.conversaciones_cuentas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mensajes_chat_cuentas ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.conversaciones_cuentas, public.mensajes_chat_cuentas
    FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON SEQUENCE public.mensajes_chat_cuentas_id_seq
    FROM PUBLIC, anon, authenticated;
