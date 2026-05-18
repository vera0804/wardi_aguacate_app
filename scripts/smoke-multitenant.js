#!/usr/bin/env node
/* eslint-disable no-console */
const path = require('path');
const { Client } = require(path.join(__dirname, '..', 'api', 'node_modules', 'pg'));

function fail(message) {
  console.error(`\n[FAIL] ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`[OK] ${message}`);
}

function info(message) {
  console.log(`[INFO] ${message}`);
}

function isCrossTenantMutationBlocked(status) {
  return status === 403 || status === 404;
}

async function queryOne(client, sql, params = []) {
  const res = await client.query(sql, params);
  return res.rows[0];
}

async function runDbChecks(client) {
  info('Running SQL tenant isolation checks...');

  const nullWorkers = await queryOne(
    client,
    `SELECT COUNT(*)::int AS total FROM workers WHERE client_id IS NULL`
  );
  const nullLabor = await queryOne(
    client,
    `SELECT COUNT(*)::int AS total FROM labor_entries WHERE client_id IS NULL`
  );
  if (nullWorkers.total !== 0) fail(`workers with null client_id: ${nullWorkers.total}`);
  else ok('workers: no null client_id');
  if (nullLabor.total !== 0) fail(`labor_entries with null client_id: ${nullLabor.total}`);
  else ok('labor_entries: no null client_id');

  const mismatchWorker = await queryOne(
    client,
    `SELECT COUNT(*)::int AS total
     FROM labor_entries le
     JOIN workers w ON w.id = le.worker_id
     WHERE le.client_id IS DISTINCT FROM w.client_id`
  );
  const mismatchLot = await queryOne(
    client,
    `SELECT COUNT(*)::int AS total
     FROM labor_entries le
     JOIN lots l ON l.id = le.lot_id
     WHERE le.lot_id IS NOT NULL
       AND le.client_id IS DISTINCT FROM l.client_id`
  );
  const mismatchFarm = await queryOne(
    client,
    `SELECT COUNT(*)::int AS total
     FROM labor_entries le
     JOIN farms f ON f.id = le.farm_id
     WHERE le.farm_id IS NOT NULL
       AND le.client_id IS DISTINCT FROM f.client_id`
  );

  if (mismatchWorker.total !== 0) fail(`labor_entries/worker client mismatch: ${mismatchWorker.total}`);
  else ok('labor_entries match worker tenant');
  if (mismatchLot.total !== 0) fail(`labor_entries/lot client mismatch: ${mismatchLot.total}`);
  else ok('labor_entries match lot tenant');
  if (mismatchFarm.total !== 0) fail(`labor_entries/farm client mismatch: ${mismatchFarm.total}`);
  else ok('labor_entries match farm tenant');

  const indexRows = await client.query(
    `SELECT indexname
     FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname IN ('idx_workers_client', 'idx_labor_entries_client')`
  );
  const indexNames = new Set(indexRows.rows.map((r) => r.indexname));
  if (!indexNames.has('idx_workers_client')) fail('missing index idx_workers_client');
  else ok('index idx_workers_client exists');
  if (!indexNames.has('idx_labor_entries_client')) fail('missing index idx_labor_entries_client');
  else ok('index idx_labor_entries_client exists');

  const nullCalibers = await queryOne(
    client,
    `SELECT COUNT(*)::int AS total FROM calibers WHERE client_id IS NULL`
  );
  if (nullCalibers.total !== 0) fail(`calibers with null client_id: ${nullCalibers.total}`);
  else ok('calibers: no null client_id');

  const mismatchProductionLot = await queryOne(
    client,
    `SELECT COUNT(*)::int AS total
     FROM lot_production lp
     JOIN lots l ON l.id = lp.lot_id
     WHERE lp.lot_id IS NOT NULL
       AND lp.client_id IS DISTINCT FROM l.client_id`
  );
  const mismatchProductionFarm = await queryOne(
    client,
    `SELECT COUNT(*)::int AS total
     FROM lot_production lp
     JOIN farms f ON f.id = lp.farm_id
     WHERE lp.farm_id IS NOT NULL
       AND lp.client_id IS DISTINCT FROM f.client_id`
  );
  const mismatchProductionCaliber = await queryOne(
    client,
    `SELECT COUNT(*)::int AS total
     FROM lot_production lp
     JOIN lot_production_details d ON d.lot_production_id = lp.id
     JOIN calibers c ON c.id = d.caliber_id
     WHERE lp.client_id IS DISTINCT FROM c.client_id`
  );

  if (mismatchProductionLot.total !== 0) {
    fail(`lot_production/lot client mismatch: ${mismatchProductionLot.total}`);
  } else ok('lot_production matches lot tenant');
  if (mismatchProductionFarm.total !== 0) {
    fail(`lot_production/farm client mismatch: ${mismatchProductionFarm.total}`);
  } else ok('lot_production matches farm tenant');
  if (mismatchProductionCaliber.total !== 0) {
    fail(`lot_production/caliber client mismatch: ${mismatchProductionCaliber.total}`);
  } else ok('lot_production details match caliber tenant');
}

function requireFetch() {
  if (typeof fetch !== 'function') {
    throw new Error(
      'This Node version does not provide fetch(). Run with Node 18+ or skip API checks.'
    );
  }
}

async function fetchJson(baseUrl, endpoint, cookie, opts = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: opts.method || 'GET',
    headers: {
      Cookie: cookie,
      ...(opts.userAgent ? { 'User-Agent': opts.userAgent } : {}),
      ...(opts.csrfToken ? { 'x-csrf-token': opts.csrfToken } : {}),
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_e) {
    json = null;
  }
  return { status: response.status, json, text };
}

async function runApiChecks() {
  const baseUrl = process.env.API_BASE_URL || 'http://localhost:3002/api';
  const cookieA = process.env.SMOKE_COOKIE_A;
  const cookieB = process.env.SMOKE_COOKIE_B;
  const csrfA = process.env.SMOKE_CSRF_A;
  const userAgentA = process.env.SMOKE_USER_AGENT_A || process.env.SMOKE_USER_AGENT || '';
  const userAgentB = process.env.SMOKE_USER_AGENT_B || process.env.SMOKE_USER_AGENT || '';

  if (!cookieA || !cookieB) {
    info('Skipping API checks: SMOKE_COOKIE_A / SMOKE_COOKIE_B not set.');
    return;
  }
  requireFetch();
  info(`Running API cross-tenant checks against ${baseUrl} ...`);

  const workersB = await fetchJson(baseUrl, '/workers?active=all', cookieB, { userAgent: userAgentB });
  if (workersB.status !== 200 || !Array.isArray(workersB.json)) {
    fail(`could not fetch workers for client B, got ${workersB.status}`);
    return;
  }
  if (workersB.json.length > 0) {
    const workerB = workersB.json[0];
    ok(`sample worker B: ${workerB.id}`);

    const workerCross = await fetchJson(baseUrl, `/workers/${workerB.id}`, cookieA, { userAgent: userAgentA });
    if (workerCross.status !== 404) {
      fail(`expected 404 reading workerB with cookieA, got ${workerCross.status}`);
    } else ok('cross-tenant GET /workers/:id returns 404');

    if (csrfA) {
      const patchWorker = await fetchJson(baseUrl, `/workers/${workerB.id}/active`, cookieA, {
        method: 'PATCH',
        userAgent: userAgentA,
        csrfToken: csrfA,
        body: { is_active: false },
      });
      if (!isCrossTenantMutationBlocked(patchWorker.status)) {
        fail(`expected 403/404 patching workerB with cookieA, got ${patchWorker.status}`);
      } else ok('cross-tenant PATCH /workers/:id/active blocked (403/404)');
    }
  } else {
    info('Skipping workers cross-tenant id checks: client B has no workers.');
  }

  const laborB = await fetchJson(baseUrl, '/labor-entries?active=all', cookieB, { userAgent: userAgentB });
  if (laborB.status !== 200 || !Array.isArray(laborB.json)) {
    fail(`could not fetch labor entries for client B, got ${laborB.status}`);
    return;
  }
  if (laborB.json.length > 0) {
    const laborEntryB = laborB.json[0];
    ok(`sample labor entry B: ${laborEntryB.id}`);

    const laborCross = await fetchJson(baseUrl, `/labor-entries/${laborEntryB.id}`, cookieA, { userAgent: userAgentA });
    if (laborCross.status !== 404) {
      fail(`expected 404 reading laborEntryB with cookieA, got ${laborCross.status}`);
    } else ok('cross-tenant GET /labor-entries/:id returns 404');

    if (csrfA) {
      const patchLabor = await fetchJson(baseUrl, `/labor-entries/${laborEntryB.id}/active`, cookieA, {
        method: 'PATCH',
        userAgent: userAgentA,
        csrfToken: csrfA,
        body: { is_active: false },
      });
      if (!isCrossTenantMutationBlocked(patchLabor.status)) {
        fail(`expected 403/404 patching laborEntryB with cookieA, got ${patchLabor.status}`);
      } else ok('cross-tenant PATCH /labor-entries/:id/active blocked (403/404)');
    }
  } else {
    info('Skipping labor entries cross-tenant id checks: client B has no labor entries.');
  }

  if (!csrfA) {
    info('Skipping PATCH cross-tenant checks: SMOKE_CSRF_A not set.');
  }

  const calibersB = await fetchJson(baseUrl, '/calibers?include_inactive=true', cookieB, {
    userAgent: userAgentB,
  });
  if (calibersB.status !== 200 || !Array.isArray(calibersB.json)) {
    fail(`could not fetch calibers for client B, got ${calibersB.status}`);
    return;
  }
  if (calibersB.json.length > 0) {
    const caliberB = calibersB.json[0];
    ok(`sample caliber B: ${caliberB.id}`);

    const caliberCross = await fetchJson(baseUrl, `/calibers/${caliberB.id}`, cookieA, {
      userAgent: userAgentA,
    });
    if (caliberCross.status !== 404) {
      fail(`expected 404 reading caliberB with cookieA, got ${caliberCross.status}`);
    } else ok('cross-tenant GET /calibers/:id returns 404');

    if (csrfA) {
      const patchCaliber = await fetchJson(baseUrl, `/calibers/${caliberB.id}/active`, cookieA, {
        method: 'PATCH',
        userAgent: userAgentA,
        csrfToken: csrfA,
        body: { is_active: false },
      });
      if (!isCrossTenantMutationBlocked(patchCaliber.status)) {
        fail(`expected 403/404 patching caliberB with cookieA, got ${patchCaliber.status}`);
      } else ok('cross-tenant PATCH /calibers/:id/active blocked (403/404)');
    }
  } else {
    info('Skipping calibers cross-tenant id checks: client B has no calibers.');
  }

  const productionB = await fetchJson(baseUrl, '/avocado-production?active=all', cookieB, {
    userAgent: userAgentB,
  });
  if (productionB.status !== 200 || !Array.isArray(productionB.json)) {
    fail(`could not fetch avocado production for client B, got ${productionB.status}`);
    return;
  }
  if (productionB.json.length > 0) {
    const productionEntryB = productionB.json[0];
    ok(`sample avocado production B: ${productionEntryB.id}`);

    const prodCross = await fetchJson(baseUrl, `/avocado-production/${productionEntryB.id}`, cookieA, {
      userAgent: userAgentA,
    });
    if (prodCross.status !== 404) {
      fail(`expected 404 reading avocadoProductionB with cookieA, got ${prodCross.status}`);
    } else ok('cross-tenant GET /avocado-production/:id returns 404');

    if (csrfA) {
      const patchProd = await fetchJson(
        baseUrl,
        `/avocado-production/${productionEntryB.id}/active`,
        cookieA,
        {
          method: 'PATCH',
          userAgent: userAgentA,
          csrfToken: csrfA,
          body: { is_active: false },
        }
      );
      if (!isCrossTenantMutationBlocked(patchProd.status)) {
        fail(`expected 403/404 patching avocadoProductionB with cookieA, got ${patchProd.status}`);
      } else ok('cross-tenant PATCH /avocado-production/:id/active blocked (403/404)');
    }
  } else {
    info('Skipping avocado production cross-tenant id checks: client B has no production rows.');
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('Set DATABASE_URL before running this script.');
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    await runDbChecks(client);
  } finally {
    await client.end();
  }

  await runApiChecks();

  if (process.exitCode && process.exitCode !== 0) {
    console.error('\nSmoke checks completed with failures.');
    process.exit(process.exitCode);
  }
  console.log('\nAll smoke checks passed.');
}

main().catch((err) => {
  console.error('\nUnexpected error running smoke checks.');
  console.error(err);
  process.exit(1);
});

