#!/usr/bin/env node
/**
 * Aplica database/migrations/*.sql ordenadas léxicamente contra DATABASE_URL una sola vez cada una.
 *
 * No sustituye herramientas enterprise (Sqitch, Liquibase): es un mínimo reproducible por repo.
 */
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
  const databaseUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL o MIGRATION_DATABASE_URL no está definido (api/.env).');
    process.exit(1);
  }

  const migDir = path.join(__dirname, 'migrations');
  const files = fs
    .readdirSync(migDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const appliedRows = await client.query(`SELECT filename FROM public.schema_migrations`);
  const applied = new Set(appliedRows.rows.map((r) => r.filename));

  try {
    for (const fn of files) {
      if (applied.has(fn)) {
        console.log(`[skip] ${fn}`);
        continue;
      }
      const sql = fs.readFileSync(path.join(migDir, fn), 'utf8');
      console.log(`[apply] ${fn}`);
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(`INSERT INTO public.schema_migrations (filename) VALUES ($1)`, [fn]);
      await client.query('COMMIT');
      console.log(`[done] ${fn}`);
    }
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('Migración falló:', e);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
