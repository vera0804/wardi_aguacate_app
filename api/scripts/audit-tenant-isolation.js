/**
 * Auditoría estática: rutas API y heurística de SQL multitenant.
 *
 * Uso: desde `api/`:  node scripts/audit-tenant-isolation.js
 */

/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const ROUTES_DIR = path.join(SRC, 'routes');
const SERVICES_DIR = path.join(SRC, 'services');

const MOUNTED_ROUTES = [
  { mount: '/api/auth', file: 'auth.routes.js', tenantScope: 'none' },
  { mount: '/api/superadmin', file: 'superadmin.routes.js', tenantScope: 'platform' },
  { mount: '/api/farms', file: 'farms.routes.js', tenantScope: 'tenant' },
  { mount: '/api/geo', file: 'geo.routes.js', tenantScope: 'reference' },
  { mount: '/api/lots', file: 'lots.routes.js', tenantScope: 'tenant' },
  { mount: '/api/workers', file: 'workers.routes.js', tenantScope: 'tenant' },
  { mount: '/api/labor-entries', file: 'labor-entries.routes.js', tenantScope: 'tenant' },
  { mount: '/api/calibers', file: 'calibers.routes.js', tenantScope: 'tenant' },
  { mount: '/api/avocado-production', file: 'avocado-production.routes.js', tenantScope: 'tenant' },
  { mount: '/api/inventory-items', file: 'inventory-items.routes.js', tenantScope: 'tenant' },
  { mount: '/api/inventory-brands', file: 'inventory-brands.routes.js', tenantScope: 'tenant' },
  { mount: '/api/inventory-movements', file: 'inventory-movements.routes.js', tenantScope: 'tenant' },
  { mount: '/api/inventory-consumptions', file: 'inventory-consumptions.routes.js', tenantScope: 'tenant' },
  { mount: '/api/mix-applications', file: 'mix-applications.routes.js', tenantScope: 'tenant' },
  { mount: '/api/calendar-activities', file: 'calendar-activities.routes.js', tenantScope: 'tenant' },
  { mount: '/api/asset-categories', file: 'asset-categories.routes.js', tenantScope: 'tenant' },
  { mount: '/api/expense-categories', file: 'expense-categories.routes.js', tenantScope: 'tenant' },
  { mount: '/api/assets', file: 'assets.routes.js', tenantScope: 'tenant' },
  { mount: '/api/asset-depreciation', file: 'asset-depreciation.routes.js', tenantScope: 'tenant' },
  { mount: '/api/expenses', file: 'expenses.routes.js', tenantScope: 'tenant' },
  { mount: '/api/general-expenses', file: 'general-expenses.routes.js', tenantScope: 'tenant' },
  { mount: '/api/general-expense-allocations', file: 'general-expense-allocations.routes.js', tenantScope: 'tenant' },
  { mount: '/api/payroll-nomina-contribution-rules', file: 'payroll-nomina-contribution-rules.routes.js', tenantScope: 'tenant' },
  { mount: '/api/aguinaldos', file: 'aguinaldos.routes.js', tenantScope: 'tenant' },
  { mount: '/api/payroll-slips', file: 'payroll-slips.routes.js', tenantScope: 'tenant' },
  { mount: '/api/tenant-users', file: 'tenant-users.routes.js', tenantScope: 'tenant' },
  { mount: '/api/stats', file: 'stats.routes.js', tenantScope: 'tenant' },
  { mount: '/api/exchange-rate', file: 'exchange-rate.routes.js', tenantScope: 'external' },
];

const TENANT_TABLE_RE =
  /\b(?:FROM|JOIN)\s+(?:ONLY\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\b/gi;

const EXPECT_TENANT_FILTER = new Set([
  'farms',
  'lots',
  'workers',
  'labor_entries',
  'labor_entry_allocations',
  'inventory_items',
  'inventory_brands',
  'inventory_movements',
  'inventory_movement_layers',
  'inventory_layers',
  'inventory_consumptions',
  'mix_applications',
  'calendar_activities',
  'assets',
  'asset_categories',
  'asset_depreciation',
  'expenses',
  'expense_categories',
  'general_expenses',
  'general_expense_allocations',
  'payroll_slips',
  'payroll_slip_lot_allocations',
  'payroll_nomina_contribution_rules',
  'aguinaldo_statements',
  'clients',
  'users',
  'sessions',
  'lot_production',
  'lot_production_allocations',
  'lot_production_details',
]);

const GLOBAL_TABLE_WHITELIST = new Set([
  'provinces',
  'cantons',
  'districts',
  'roles',
  'plans',
  'avocado_calibers',
  'calibers',
  'avocado_varieties',
  'labor_types',
  'client_plans',
]);

/** Archivos donde las consultas sin client_id son esperadas. */
const SERVICE_FILE_EXEMPT = new Set(['auth.service.js', 'superadmin.service.js']);

/**
 * Clasifica un literal SQL que no contiene la subcadena client_id.
 * @returns {{ kind: 'skip'|'review', reason: string }|null} null si no aplica (tiene client_id)
 */
function classifySqlLiteral({ serviceFile, sql, table }) {
  const norm = sql.replace(/\s+/g, ' ').trim();

  if (SERVICE_FILE_EXEMPT.has(serviceFile)) {
    if (table === 'sessions' || norm.includes('DELETE FROM public.sessions')) {
      return { kind: 'skip', reason: 'housekeeping de sesiones (no es dato de tenant)' };
    }
    if (table === 'clients' || table === 'users') {
      return { kind: 'skip', reason: 'alcance plataforma (superadmin)' };
    }
  }

  if (serviceFile === 'tenant-users.service.js' && table === 'users' && norm.includes('lower(trim(email))')) {
    return { kind: 'skip', reason: 'unicidad global de email (login)' };
  }

  if (
    /^DELETE FROM (labor_entry_allocations|payroll_slip_lot_allocations|lot_production_allocations|lot_production_details)\b/i.test(
      norm
    ) &&
    /EXISTS\s*\(/i.test(norm)
  ) {
    return { kind: 'skip', reason: 'DELETE hijo acotado por EXISTS al padre tenant' };
  }

  if (table === 'inventory_consumptions' && norm.includes('EXISTS') && norm.includes('lots l')) {
    return { kind: 'skip', reason: 'consumo validado vía JOIN/EXISTS a lots.client_id' };
  }

  if (table === 'labor_types') {
    return { kind: 'skip', reason: 'catálogo global labor_types' };
  }

  return { kind: 'review', reason: 'revisar manualmente o añadir filtro client_id / EXISTS' };
}

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

function analyzeRoutesFile(relFile) {
  const full = path.join(ROUTES_DIR, relFile);
  if (!fs.existsSync(full)) {
    return { error: `missing ${relFile}` };
  }
  const text = read(full);
  const usesEffective = /\brequireEffectiveClient\b/.test(text);

  const rolesFromText = [];
  const rr = /requireRoles\(\[([^\]]+)\]\)/g;
  let m;
  while ((m = rr.exec(text)) !== null) {
    m[1]
      .split(',')
      .map((s) => s.replace(/['"]/g, '').trim().toLowerCase())
      .filter(Boolean)
      .forEach((r) => {
        if (!rolesFromText.includes(r)) rolesFromText.push(r);
      });
  }

  const routerUseMatch = text.match(/router\.use\([^;]+;/gs) || [];
  const firstUse = routerUseMatch[0] || '';
  const allowsSuperadmin = rolesFromText.includes('superadmin');

  return {
    usesRequireEffectiveClient: usesEffective,
    routerUseSnippet: firstUse.replace(/\s+/g, ' ').slice(0, 200),
    rolesDetected: rolesFromText,
    allowsSuperadmin,
  };
}

function classifyRouter(a, tenantScope) {
  if (tenantScope === 'none' || tenantScope === 'platform' || tenantScope === 'reference' || tenantScope === 'external') {
    return 'n/a';
  }
  if (a.error) return 'unknown';
  if (a.usesRequireEffectiveClient) return 'protected_uniform';
  return 'partial_middleware';
}

function extractSqlLiterals(serviceText) {
  const out = [];
  const re = /(?:pool|db|client)\.query\s*\(\s*`([\s\S]*?)`/g;
  let m;
  while ((m = re.exec(serviceText)) !== null) {
    out.push(m[1]);
  }
  return out;
}

function auditServiceFile(filePath) {
  const text = read(filePath);
  const file = path.basename(filePath);
  const review = [];
  const skipped = [];
  const literals = extractSqlLiterals(text);

  literals.forEach((sql, i) => {
    if (sql.includes('client_id')) return;

    const tables = new Set();
    let tm;
    const localRe = new RegExp(TENANT_TABLE_RE.source, 'gi');
    while ((tm = localRe.exec(sql)) !== null) {
      tables.add(tm[1].toLowerCase());
    }

    for (const t of tables) {
      if (GLOBAL_TABLE_WHITELIST.has(t)) continue;
      if (!EXPECT_TENANT_FILTER.has(t)) continue;

      const cls = classifySqlLiteral({ serviceFile: file, sql, table: t });
      const hit = { sqlIndex: i, table: t, preview: sql.replace(/\s+/g, ' ').slice(0, 140), ...cls };
      if (cls.kind === 'skip') skipped.push(hit);
      else review.push(hit);
    }
  });

  return { file, review, skipped };
}

function walkServices(dir) {
  const files = [];
  for (const name of fs.readdirSync(dir)) {
    if (name.endsWith('.service.js')) files.push(path.join(dir, name));
  }
  return files;
}

function main() {
  console.log('=== Auditoría multitenant (rutas) ===\n');
  const routesReport = [];

  console.log('| Montaje | Router | scope | effectiveClient | roles (únicos) | clasificación |\n|---|---|---|---|---|---|');
  for (const row of MOUNTED_ROUTES) {
    const a = analyzeRoutesFile(row.file);
    const cls = classifyRouter(a, row.tenantScope);
    const eff = row.tenantScope === 'tenant' ? (a.usesRequireEffectiveClient ? 'sí' : 'no') : '—';
    const rolesShort = (a.rolesDetected || []).join(', ') || '—';
    routesReport.push({ ...row, analysis: a, classification: cls });
    console.log(
      `| ${row.mount} | ${row.file} | ${row.tenantScope} | ${eff} | ${rolesShort} | ${cls} |`
    );
  }

  console.log('\n=== Heurística SQL (services/*.service.js) ===\n');
  console.log(
    'Sin `client_id` en el literal: se clasifica como omitido esperado o pendiente de revisión.\n'
  );

  const serviceFiles = walkServices(SERVICES_DIR);
  let totalReview = 0;
  let totalSkipped = 0;

  for (const fp of serviceFiles.sort()) {
    const { file, review, skipped } = auditServiceFile(fp);
    if (review.length === 0 && skipped.length === 0) continue;

    if (skipped.length) {
      totalSkipped += skipped.length;
      console.log(`\n-- ${file} (${skipped.length} omitidos esperados)`);
      for (const h of skipped.slice(0, 6)) {
        console.log(`   [${h.table}] ${h.reason}`);
      }
      if (skipped.length > 6) console.log(`   … y ${skipped.length - 6} más`);
    }

    if (review.length) {
      totalReview += review.length;
      console.log(`\n-- ${file} (${review.length} PENDIENTE revisión)`);
      for (const h of review.slice(0, 12)) {
        console.log(`   [${h.table}] ${h.preview}${h.preview.length >= 140 ? '…' : ''}`);
      }
      if (review.length > 12) console.log(`   … y ${review.length - 12} más`);
    }
  }

  if (totalReview === 0 && totalSkipped === 0) {
    console.log('\nNingún hallazgo SQL con la heurística actual.');
  }

  console.log('\n=== Resumen ===\n');
  const tenantRows = routesReport.filter((r) => r.tenantScope === 'tenant');
  const withEff = tenantRows.filter((r) => r.analysis.usesRequireEffectiveClient).length;
  console.log(
    `Routers tenant: ${tenantRows.length}. Con requireEffectiveClient: ${withEff}. Sin él: ${tenantRows.length - withEff}.`
  );
  console.log(`SQL omitidos esperados: ${totalSkipped}. SQL pendientes de revisión: ${totalReview}.`);

  if (totalReview > 0) {
    process.exitCode = 1;
  }
}

main();
