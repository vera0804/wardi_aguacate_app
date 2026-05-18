-- Privilegios del rol de aplicación (debe existir: node database/setup-app-role.js).
-- La API usa DATABASE_URL con ese rol en producción para que RLS aplique.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wardi_app') THEN
    RAISE EXCEPTION 'Rol wardi_app no existe. Ejecute: node database/setup-app-role.js';
  END IF;
END $$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO wardi_app', current_database());
END $$;

GRANT USAGE ON SCHEMA public TO wardi_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO wardi_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO wardi_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO wardi_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO wardi_app;

GRANT EXECUTE ON FUNCTION public.app_current_tenant_id() TO wardi_app;
