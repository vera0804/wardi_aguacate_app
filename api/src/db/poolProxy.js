'use strict';

const { Pool } = require('pg');
const config = require('../config');
const { getTenantStore, createSavepointClient } = require('./tenantContext');

const basePool = new Pool({
  connectionString: config.databaseUrl,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

basePool.on('error', (err) => {
  console.error('Unexpected PostgreSQL client error', err);
});

/**
 * Pool enrutado: dentro de un request con contexto tenant usa la misma conexión + RLS.
 */
const pool = {
  query(text, params) {
    const store = getTenantStore();
    if (store?.client) {
      return store.client.query(text, params);
    }
    return basePool.query(text, params);
  },

  async connect() {
    const store = getTenantStore();
    if (store?.client) {
      return createSavepointClient(store.client);
    }
    return basePool.connect();
  },

  on(event, listener) {
    return basePool.on(event, listener);
  },

  end() {
    return basePool.end();
  },
};

module.exports = { pool, basePool };
