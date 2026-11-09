-- Aplicar antes de desplegar el código que consulta esta columna.
ALTER TABLE public.vehiculos ADD COLUMN IF NOT EXISTS retirado_en TIMESTAMPTZ;
COMMENT ON COLUMN public.vehiculos.retirado_en IS 'Fecha del retiro lógico; NULL indica publicación activa.';
