-- Crear el primer usuario superadmin (ejecutar manualmente tras roles/migraciones base).
-- Requisitos:
--   1) Debe existir al menos un cliente en public.clients (p. ej. la primera organización).
--   2) Ajuste EMAIL, HASH (bcrypt cost 12) e id_number únicos *en esa organización*
--      tras la migración uq_users_id_doc_per_client (documento único por client_id).
--
--    node -e "require('bcrypt').hash('MiClaveSegura1', 12).then(console.log)"

INSERT INTO public.users (
  is_active, first_name, last_name_1, last_name_2, email,
  phone_1, phone_2, id_type, id_number, password_hash,
  client_id, role_id, failed_attempts
)
SELECT
  true,
  'Plataforma',
  'Superadmin',
  NULL,
  'EMAIL',
  NULL, NULL,
  'extranjero'::public.id_type,
  'SUPERADMIN-BOOT-1',
  'HASH',
  (SELECT c.id FROM public.clients c ORDER BY c.created_at ASC LIMIT 1),
  r.id,
  0
FROM public.roles r
WHERE lower(trim(r.name)) = 'superadmin'
  AND EXISTS (SELECT 1 FROM public.clients)
LIMIT 1;
