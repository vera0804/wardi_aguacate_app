-- Permite inactivar planes sin borrarlos (clientes existentes conservan plan_id).

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.plans.is_active IS
  'false = no aparece al crear organizaciones; clientes ya asignados siguen usando el plan.';

UPDATE public.plans SET is_active = true WHERE is_active IS NULL;
