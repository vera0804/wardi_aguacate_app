'use strict';

const config = require('../config');
const { basePool } = require('../db/poolProxy');
const { runWithTenantStore } = require('../db/tenantContext');

/**
 * Abre una transacción por request HTTP, fija app.tenant_id (SET LOCAL) y enruta pool.query
 * a esa conexión. Requiere DATABASE_URL con rol sin SUPERUSER/BYPASSRLS para que RLS aplique.
 */
function bindTenantRlsContext(req, res, next) {
  if (!config.tenantRlsRequestScope) {
    return next();
  }

  const tenantId = req.user?.clientId != null ? String(req.user.clientId).trim() : '';
  if (!tenantId) {
    return next();
  }

  let released = false;

  const finishTxn = async () => {
    if (released) return;
    released = true;
    const client = req._tenantRlsClient;
    if (!client) return;
    try {
      await client.query('COMMIT');
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      console.error('tenant RLS transaction end', e);
    } finally {
      try {
        client.release();
      } catch {
        /* ignore */
      }
      req._tenantRlsClient = null;
    }
  };

  basePool
    .connect()
    .then(async (client) => {
      req._tenantRlsClient = client;
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

      res.once('finish', () => {
        finishTxn().catch(() => {});
      });
      res.once('close', () => {
        finishTxn().catch(() => {});
      });

      runWithTenantStore({ client, tenantId }, () => {
        next();
      });
    })
    .catch((e) => {
      console.error('bindTenantRlsContext', e);
      next(e);
    });
}

module.exports = { bindTenantRlsContext };
