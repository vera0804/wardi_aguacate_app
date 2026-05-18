'use strict';

const { pool } = require('./db');
const { getTenantStore, createSavepointClient } = require('./tenantContext');

/**
 * Ejecuta trabajo dentro de una transacción con:
 *   set_config('app.tenant_id', tenantUuid, true)  -- verdadero === SET LOCAL (transacción)
 * para habilitar Row Level Security cuando el rol PostgreSQL ya no sea superusuario.
 *
 * Migración práctica típica: reemplazar `pool.query` por `withTenantTransaction` SOLO donde
 * haya garantizado `tenantId`; no hacerlo en rutas globales como superadmin de plataforma.
 *
 * @param {string|null|undefined} tenantId UUID efectivo del tenant
 * @param {(client: import('pg').PoolClient) => Promise<void>} fn
 */
async function withTenantTransaction(tenantId, fn) {
  const tid = tenantId != null ? String(tenantId).trim() : '';
  if (!tid) {
    const err = new Error('tenantId requerido para withTenantTransaction');
    err.status = 400;
    throw err;
  }

  const store = getTenantStore();
  if (store?.client && store.tenantId === tid) {
    return fn(createSavepointClient(store.client));
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tid]);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { withTenantTransaction };
