ALTER TABLE public.vehiculos ADD COLUMN vendedor_id UUID REFERENCES public.roles_usuarios(usuario_id) ON DELETE RESTRICT;
CREATE INDEX vehiculos_vendedor_idx ON public.vehiculos(vendedor_id);
CREATE OR REPLACE FUNCTION public.v72_propietario() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.vendedor_id IS NOT NULL AND NEW.vendedor_id IS DISTINCT FROM OLD.vendedor_id THEN
    RAISE EXCEPTION 'El propietario no puede cambiar';
  END IF;
  IF NEW.vendedor_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.roles_usuarios WHERE usuario_id=NEW.vendedor_id AND rol='vendedor') THEN
    RAISE EXCEPTION 'El propietario debe ser vendedor';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.v72_propietario() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER v72_propietario BEFORE INSERT OR UPDATE OF vendedor_id ON public.vehiculos FOR EACH ROW EXECUTE FUNCTION public.v72_propietario();
