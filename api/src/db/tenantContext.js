'use strict';

const { AsyncLocalStorage } = require('async_hooks');

const tenantStorage = new AsyncLocalStorage();

function getTenantStore() {
  return tenantStorage.getStore();
}

function runWithTenantStore(store, fn) {
  return tenantStorage.run(store, fn);
}

/**
 * Cliente que reutiliza la conexión del request y traduce BEGIN/COMMIT/ROLLBACK a savepoints.
 * @param {import('pg').PoolClient} client
 */
function createSavepointClient(client) {
  let depth = 0;

  return {
    query(text, params) {
      const head = String(text || '').trim().split(/\s+/)[0].toUpperCase();
      if (head === 'BEGIN') {
        depth += 1;
        return client.query(`SAVEPOINT wardi_sp_${depth}`);
      }
      if (head === 'COMMIT') {
        if (depth > 0) {
          const d = depth;
          depth -= 1;
          return client.query(`RELEASE SAVEPOINT wardi_sp_${d}`);
        }
        return client.query('SELECT 1');
      }
      if (head === 'ROLLBACK') {
        if (depth > 0) {
          const d = depth;
          depth -= 1;
          return client.query(`ROLLBACK TO SAVEPOINT wardi_sp_${d}`);
        }
        return client.query('SELECT 1');
      }
      return client.query(text, params);
    },
    release() {
      /* La conexión la libera el middleware del request. */
    },
  };
}

module.exports = {
  tenantStorage,
  getTenantStore,
  runWithTenantStore,
  createSavepointClient,
};
