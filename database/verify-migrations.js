#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

function loadEnvFile() {
  const envPath = path.join(__dirname, '..', 'api', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvFile();
const { Client } = require(path.join(__dirname, '..', 'api', 'node_modules', 'pg'));

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL no definido (api/.env).');
    process.exit(1);
  }
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  let mig = { rows: [] };
  const migTable = await c.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'schema_migrations'
     ) AS ok`
  );
  if (migTable.rows[0].ok) {
    mig = await c.query(`SELECT filename, applied_at FROM public.schema_migrations ORDER BY filename`);
  }
  const fn = await c.query(
    `SELECT EXISTS (
       SELECT 1 FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'app_current_tenant_id'
     ) AS ok`
  );
  const rls = await c.query(
    `SELECT COUNT(*)::int AS policies,
            COUNT(DISTINCT tablename)::int AS tables
     FROM pg_policies
     WHERE schemaname = 'public' AND policyname = 'wardi_tenant_isolation'`
  );
  const role = await c.query(
    `SELECT current_user AS db_user,
            (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_superuser,
            (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass_rls`
  );

  console.log('=== Migraciones (schema_migrations) ===');
  if (!migTable.rows[0].ok) {
    console.log('  Tabla schema_migrations: NO (¿aplicaste SQL a mano sin el runner?)');
  } else {
    mig.rows.forEach((r) => console.log(`  ${r.filename}`));
    console.log(`  Total registradas: ${mig.rows.length}`);
  }

  console.log('\n=== RLS ===');
  console.log(`  app_current_tenant_id(): ${fn.rows[0].ok ? 'sí' : 'NO'}`);
  console.log(`  Políticas wardi_tenant_isolation: ${rls.rows[0].policies} en ${rls.rows[0].tables} tablas`);

  console.log('\n=== Rol de conexión actual ===');
  console.log(`  Usuario: ${role.rows[0].db_user}`);
  console.log(`  Superuser: ${role.rows[0].is_superuser}`);
  console.log(`  BYPASSRLS: ${role.rows[0].bypass_rls}`);

  if (role.rows[0].is_superuser) {
    console.log(
      '\nNota: con superuser, PostgreSQL NO aplica RLS. La API seguirá igual hasta usar un rol app sin superuser + set_config por transacción.'
    );
  }

  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
