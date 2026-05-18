#!/usr/bin/env node
/**
 * Crea el rol wardi_app (sin superuser / sin bypass RLS) y opcionalmente contraseña.
 *
 * Uso (como superuser en DATABASE_URL o MIGRATION_DATABASE_URL):
 *   set MIGRATION_DATABASE_URL=postgres://postgres:pass@localhost:5432/tu_db
 *   set PG_APP_PASSWORD=elige_una_contraseña_segura
 *   node database/setup-app-role.js
 *
 * Luego:
 *   npm run db:migrate
 *   DATABASE_URL=postgres://wardi_app:...@host:5432/tu_db  (en api/.env producción)
 */
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { Client } = require(path.join(__dirname, '..', 'api', 'node_modules', 'pg'));

const ROLE = process.env.PG_APP_ROLE || 'wardi_app';

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

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('Defina MIGRATION_DATABASE_URL o DATABASE_URL (usuario con permisos CREATEDB/CREATEROLE).');
    process.exit(1);
  }

  const password = process.env.PG_APP_PASSWORD;
  if (!password || String(password).length < 12) {
    console.error('Falta PG_APP_PASSWORD (mínimo 12 caracteres) para el rol wardi_app.\n');
    console.error('Opción A — en api/.env (recomendado, no la subas a git):');
    console.error('  PG_APP_PASSWORD=tu_contraseña_larga_segura\n');
    console.error('Opción B — solo en esta terminal (PowerShell):');
    console.error('  $env:PG_APP_PASSWORD="tu_contraseña_larga_segura"');
    console.error('  npm run db:setup-role\n');
    console.error('DATABASE_URL debe seguir siendo postgres (superuser) para crear el rol.');
    console.error('Después cambia DATABASE_URL a wardi_app y ejecuta npm run db:verify.');
    process.exit(1);
  }

  const c = new Client({ connectionString: url });
  await c.connect();

  const exists = await c.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [ROLE]);
  if (!exists.rows[0]) {
    await c.query(
      `CREATE ROLE ${quoteIdent(ROLE)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`
    );
    console.log(`[OK] Rol ${ROLE} creado.`);
  }
  await c.query(
    `ALTER ROLE ${quoteIdent(ROLE)} WITH LOGIN PASSWORD ${escapeLiteral(password)} NOSUPERUSER NOBYPASSRLS`
  );
  console.log(`[OK] Contraseña de ${ROLE} actualizada.`);

  const dbName = (await c.query('SELECT current_database() AS n')).rows[0].n;
  await c.query(`GRANT CONNECT ON DATABASE ${quoteIdent(dbName)} TO ${quoteIdent(ROLE)}`);
  await c.query(`GRANT USAGE ON SCHEMA public TO ${quoteIdent(ROLE)}`);
  await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${quoteIdent(ROLE)}`);
  await c.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${quoteIdent(ROLE)}`);

  console.log(`\nActualice api/.env para producción:\nDATABASE_URL=postgres://${ROLE}:<PG_APP_PASSWORD>@<host>:5432/${dbName}\n`);
  console.log('Luego: npm run db:migrate (si faltan grants de la migración 20260718120000).');

  await c.end();
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function escapeLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
