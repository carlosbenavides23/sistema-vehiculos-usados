-- Perfil mínimo y privado: no guarda email, credenciales ni datos de autorización.
CREATE TABLE public.perfiles_usuarios (
    usuario_id UUID PRIMARY KEY
        REFERENCES public.roles_usuarios(usuario_id) ON DELETE CASCADE,
    nombre_visible TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT perfiles_usuarios_nombre_largo CHECK (
        char_length(nombre_visible) BETWEEN 2 AND 40
    ),
    CONSTRAINT perfiles_usuarios_nombre_normalizado CHECK (
        nombre_visible = btrim(regexp_replace(nombre_visible, '[[:space:]]+', ' ', 'g'))
        AND nombre_visible !~ '[[:cntrl:]]'
    )
);
ALTER TABLE public.perfiles_usuarios ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.perfiles_usuarios FROM PUBLIC, anon, authenticated;

-- Supabase ejecuta el trigger dentro de la transacción de auth.users. Si el
-- nombre no es válido, no queda una identidad o un rol parcial.
CREATE OR REPLACE FUNCTION public.v71_crear_rol() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  rol_inicial TEXT;
  nombre_inicial TEXT;
BEGIN
  rol_inicial := NEW.raw_user_meta_data->>'v71_rol';
  IF rol_inicial IS NULL OR rol_inicial NOT IN ('comprador', 'vendedor') THEN
    RAISE EXCEPTION 'Rol inicial no válido';
  END IF;

  nombre_inicial := NEW.raw_user_meta_data->>'v76_nombre_visible';
  IF nombre_inicial IS NULL OR nombre_inicial ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Nombre visible no válido';
  END IF;
  nombre_inicial := regexp_replace(btrim(nombre_inicial), '[[:space:]]+', ' ', 'g');
  IF char_length(nombre_inicial) NOT BETWEEN 2 AND 40 THEN
    RAISE EXCEPTION 'Nombre visible no válido';
  END IF;

  INSERT INTO public.roles_usuarios(usuario_id, rol)
  VALUES (NEW.id, rol_inicial);
  INSERT INTO public.perfiles_usuarios(usuario_id, nombre_visible)
  VALUES (NEW.id, nombre_inicial);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.v71_crear_rol() FROM PUBLIC, anon, authenticated;

-- El trigger V7.1 ya existe en Supabase. Esta cláusula conserva instalación
-- idempotente en entornos locales que preparan auth.users después de migrar.
DO $$ BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'auth.users'::regclass AND tgname = 'v71_rol_inicial'
    ) THEN
      CREATE TRIGGER v71_rol_inicial AFTER INSERT ON auth.users
        FOR EACH ROW EXECUTE FUNCTION public.v71_crear_rol();
    END IF;
  END IF;
END $$;
