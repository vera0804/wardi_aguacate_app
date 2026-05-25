-- Deshace lo aplicado por database/migrations/20260521170000_client_license_plans.sql
-- Ejecutar manualmente con usuario DDL (p. ej. postgres), NO forma parte del runner automático.
--
-- Pasos sugeridos:
--   1) psql ... -f database/scripts/rollback_client_license_plans.sql
--   2) DELETE FROM public.schema_migrations
--      WHERE filename = '20260521170000_client_license_plans.sql';
--   3) npm run db:migrate   (vuelve a aplicar la migración completa)

UPDATE public.plans
SET billing_model = 'perpetual',
    trial_days = NULL
WHERE lower(trim(name)) LIKE '%demo%';

ALTER TABLE public.clients
  DROP COLUMN IF EXISTS billing_anchor_day,
  DROP COLUMN IF EXISTS license_expires_on,
  DROP COLUMN IF EXISTS license_starts_on;

ALTER TABLE public.plans
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS trial_days,
  DROP COLUMN IF EXISTS billing_model;
