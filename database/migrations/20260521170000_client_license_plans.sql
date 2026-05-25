-- Planes: modelo de facturación y días de demo.
-- Clientes: fechas de licencia y día de ancla para planes mensuales.

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS billing_model character varying(32) NOT NULL DEFAULT 'perpetual',
  ADD COLUMN IF NOT EXISTS trial_days integer,
  ADD COLUMN IF NOT EXISTS description text;

COMMENT ON COLUMN public.plans.billing_model IS
  'perpetual | trial_days | monthly_anchor — define cómo se calcula license_expires_on del cliente.';
COMMENT ON COLUMN public.plans.trial_days IS
  'Días de vigencia para billing_model = trial_days (p. ej. demo 30 días).';
COMMENT ON COLUMN public.plans.description IS
  'Texto descriptivo del plan para superadmin.';

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS license_starts_on date,
  ADD COLUMN IF NOT EXISTS license_expires_on date,
  ADD COLUMN IF NOT EXISTS billing_anchor_day smallint;

COMMENT ON COLUMN public.clients.license_starts_on IS
  'Inicio de vigencia (creación o última renovación).';
COMMENT ON COLUMN public.clients.license_expires_on IS
  'Último día inclusive de vigencia; el cron de medianoche revoca sesiones si hoy > esta fecha.';
COMMENT ON COLUMN public.clients.billing_anchor_day IS
  'Día del mes (1-28) para renovación mensual cuando el plan usa monthly_anchor.';

-- Plan Demo existente: 30 días desde alta/renovación
UPDATE public.plans
SET billing_model = 'trial_days',
    trial_days = COALESCE(trial_days, 30),
    description = COALESCE(
      description,
      'Demostración: vigencia limitada desde la fecha de alta o renovación.'
    )
WHERE lower(trim(name)) LIKE '%demo%';
