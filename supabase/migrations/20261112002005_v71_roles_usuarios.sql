-- Auth asigna el rol en la misma transacción que crea la identidad.
CREATE TABLE IF NOT EXISTS public.roles_usuarios (
    usuario_id UUID PRIMARY KEY,
    rol TEXT NOT NULL CHECK (rol IN ('comprador', 'vendedor')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.roles_usuarios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.roles_usuarios FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.v71_crear_rol() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.raw_user_meta_data->>'v71_rol' NOT IN ('comprador', 'vendedor') OR NEW.raw_user_meta_data->>'v71_rol' IS NULL THEN
    RAISE EXCEPTION 'Rol inicial no válido';
  END IF;
  INSERT INTO public.roles_usuarios(usuario_id, rol) VALUES (NEW.id, NEW.raw_user_meta_data->>'v71_rol');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.v71_crear_rol() FROM PUBLIC, anon, authenticated;
-- PostgreSQL de pruebas del inventario no contiene Auth. En Supabase el trigger
-- y la FK se instalan obligatoriamente al existir auth.users.
DO $$ BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.roles_usuarios'::regclass AND conname='roles_usuario_auth_fk') THEN
      ALTER TABLE public.roles_usuarios ADD CONSTRAINT roles_usuario_auth_fk FOREIGN KEY(usuario_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='auth.users'::regclass AND tgname='v71_rol_inicial') THEN
      CREATE TRIGGER v71_rol_inicial AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.v71_crear_rol();
    END IF;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.sesiones_cuenta (
  verificador CHAR(64) PRIMARY KEY,
  usuario_id UUID NOT NULL REFERENCES public.roles_usuarios(usuario_id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE public.sesiones_cuenta ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sesiones_cuenta FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.v71_rol_inmutable() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.usuario_id IS DISTINCT FROM OLD.usuario_id OR NEW.rol IS DISTINCT FROM OLD.rol THEN
    RAISE EXCEPTION 'El rol de la cuenta es inmutable';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.v71_rol_inmutable() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS v71_rol_inmutable ON public.roles_usuarios;
CREATE TRIGGER v71_rol_inmutable BEFORE UPDATE ON public.roles_usuarios FOR EACH ROW EXECUTE FUNCTION public.v71_rol_inmutable();
