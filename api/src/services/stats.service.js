const { pool } = require('../db');

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function parseDateRange(query) {
  const today = new Date().toISOString().slice(0, 10);
  let from = query.from || query.from_date;
  let to = query.to || query.to_date;
  if (!to) to = today;
  if (!from) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 89);
    from = d.toISOString().slice(0, 10);
  }
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(from) || !re.test(to)) {
    const err = new Error('Las fechas from y to deben ser YYYY-MM-DD.');
    err.status = 400;
    throw err;
  }
  if (from > to) {
    const err = new Error('La fecha inicial no puede ser mayor que la final.');
    err.status = 400;
    throw err;
  }
  const farmId = query.farm_id && String(query.farm_id).trim() ? String(query.farm_id).trim() : null;
  const lotId = query.lot_id && String(query.lot_id).trim() ? String(query.lot_id).trim() : null;
  return { from, to, farmId, lotId };
}

/**
 * Depreciación mensual (asset_depreciation) de activos en estado **activo** y filas de depreciación **activas**,
 * cuyo mes calendario intersecta [from, to]. Como los activos no tienen lote, el monto se escala al alcance
 * del reporte (ha de lotes filtrados / ha de todos los lotes del cliente) y se reparte entre lotes del alcance
 * por área; sin ha positiva, reparto equitativo entre esos lotes.
 */
async function getAssetDepreciationAllocByLot({ clientId, from, to, farmId, lotId }) {
  const depParams = [clientId, from, to];
  const scopeParams = [clientId];
  let sidx = 2;
  let scopeLotFarmFilter = '';
  if (farmId) {
    scopeLotFarmFilter += ` AND l.farm_id = $${sidx}::uuid`;
    scopeParams.push(farmId);
    sidx += 1;
  }
  if (lotId) {
    scopeLotFarmFilter += ` AND l.id = $${sidx}::uuid`;
    scopeParams.push(lotId);
    sidx += 1;
  }

  const depRes = await pool.query(
    `SELECT COALESCE(SUM(ad.depreciation_amount), 0)::numeric(14,2) AS n
     FROM asset_depreciation ad
     INNER JOIN assets a ON a.id = ad.asset_id AND a.client_id = $1
     WHERE ad.client_id = $1
       AND a.status = 'activo'
       AND ad.status = 'activo'
       AND make_date(ad.period_year, ad.period_month, 1) <= $3::date
       AND (make_date(ad.period_year, ad.period_month, 1) + INTERVAL '1 month - 1 day')::date >= $2::date`,
    depParams
  );
  const totalDepClient = round2(Number(depRes.rows[0]?.n || 0));

  const [allLotsRes, scopeLotsRes] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(GREATEST(COALESCE(l.area_ha, 0), 0)), 0)::numeric AS sum_ha,
              COUNT(*)::int AS n
       FROM lots l
       WHERE l.client_id = $1 AND l.is_active = true`,
      [clientId]
    ),
    pool.query(
      `SELECT l.id AS lot_id, COALESCE(l.area_ha, 0)::numeric AS ha
       FROM lots l
       WHERE l.client_id = $1 AND l.is_active = true
         ${scopeLotFarmFilter}`,
      scopeParams
    ),
  ]);

  const allSumHa = Number(allLotsRes.rows[0]?.sum_ha || 0);
  const allLotCount = Number(allLotsRes.rows[0]?.n || 0);
  const scopeRows = scopeLotsRes.rows.map((r) => ({
    lot_id: String(r.lot_id),
    ha: Math.max(0, Number(r.ha || 0)),
  }));
  const scopeSumHa = scopeRows.reduce((s, x) => s + x.ha, 0);
  const scopeLotCount = scopeRows.length;

  const byLot = new Map();
  if (totalDepClient <= 0 || scopeLotCount === 0) {
    return { totalCrc: 0, byLot };
  }

  let scale = 1;
  if (allSumHa > 0) {
    scale = scopeSumHa / allSumHa;
  } else if (allLotCount > 0) {
    scale = scopeLotCount / allLotCount;
  }

  let scaledTotal = round2(totalDepClient * scale);
  if (scaledTotal <= 0) {
    return { totalCrc: 0, byLot };
  }

  if (scopeSumHa > 0) {
    let allocated = 0;
    scopeRows.forEach((row, i) => {
      const raw = (scaledTotal * row.ha) / scopeSumHa;
      const amt = i === scopeRows.length - 1 ? round2(scaledTotal - allocated) : round2(raw);
      allocated += amt;
      byLot.set(row.lot_id, amt);
    });
  } else {
    const per = round2(scaledTotal / scopeLotCount);
    let allocated = 0;
    scopeRows.forEach((row, i) => {
      const amt = i === scopeRows.length - 1 ? round2(scaledTotal - allocated) : per;
      allocated += amt;
      byLot.set(row.lot_id, amt);
    });
  }

  return { totalCrc: scaledTotal, byLot };
}

/**
 * Evita duplicar costo: las jornadas registradas en `labor_entries` no se suman si ese día
 * ya está cubierto por una planilla **pagada** (`payroll_slips`) del mismo trabajador.
 * El costo de planilla sigue saliendo solo de `payroll_slip_lot_allocations` con planilla pagada.
 */
const SQL_LABOR_EXCLUDE_IF_DAY_COVERED_BY_PAID_PAYROLL = `
  AND NOT EXISTS (
    SELECT 1
    FROM payroll_slips ps
    WHERE ps.client_id = le.client_id
      AND ps.worker_id = le.worker_id
      AND ps.status = 'pagada'
      AND le.work_date >= ps.period_from
      AND le.work_date <= ps.period_to
  )`;

/** CTE reutilizable: producciones del cliente en rango, con filtro finca/lote opcional. */
function sqlLpBase({ paramFrom, paramTo, farmPlaceholder, lotPlaceholder }) {
  return `
    lp_base AS (
      SELECT lp.id AS lp_id, lp.lot_id AS header_lot_id, lp.prod_date
      FROM lot_production lp
      INNER JOIN lots l ON l.id = lp.lot_id AND l.client_id = $1
      WHERE lp.is_active = true
        AND lp.client_id = $1
        AND lp.prod_date >= ${paramFrom}::date
        AND lp.prod_date <= ${paramTo}::date
        ${farmPlaceholder ? 'AND l.farm_id = ' + farmPlaceholder + '::uuid' : ''}
        ${lotPlaceholder ? 'AND l.id = ' + lotPlaceholder + '::uuid' : ''}
    )`;
}

async function getTotalProductionKgAndRevenue({ clientId, from, to, farmId, lotId }) {
  const farmPh = farmId ? '$4' : null;
  const lotPh = lotId ? (farmId ? '$5' : '$4') : null;
  const params = [clientId, from, to];
  if (farmId) params.push(farmId);
  if (lotId) params.push(lotId);

  const res = await pool.query(
    `WITH ${sqlLpBase({ paramFrom: '$2', paramTo: '$3', farmPlaceholder: farmPh, lotPlaceholder: lotPh })},
    per_production AS (
      SELECT b.lp_id, SUM(lpd.kilos)::numeric(14,3) AS kg, SUM(lpd.total_amount)::numeric(14,2) AS revenue
      FROM lp_base b
      INNER JOIN lot_production_details lpd ON lpd.lot_production_id = b.lp_id
      GROUP BY b.lp_id
    )
    SELECT
      COALESCE(SUM(pp.kg), 0)::numeric(14,3) AS total_kg,
      COALESCE(SUM(pp.revenue), 0)::numeric(14,2) AS total_revenue_crc
    FROM per_production pp`,
    params
  );
  return {
    totalKg: Number(res.rows[0]?.total_kg || 0),
    totalRevenueCrc: Number(res.rows[0]?.total_revenue_crc || 0),
  };
}

async function getCostBreakdown({ clientId, from, to, farmId, lotId, assetDepreciationAlloc }) {
  const depAlloc =
    assetDepreciationAlloc ??
    (await getAssetDepreciationAllocByLot({ clientId, from, to, farmId, lotId }));
  const assetDepreciationCrc = depAlloc.totalCrc;

  const params = [clientId, from, to];
  let p = 4;
  const farmParam = farmId ? `$${p++}` : null;
  const lotParam = lotId ? `$${p++}` : null;
  if (farmId) params.push(farmId);
  if (lotId) params.push(lotId);

  const lotJoin = `INNER JOIN lots l ON l.id = e.lot_id AND l.client_id = $1`;
  const farmLotFilter =
    (farmId ? ` AND l.farm_id = ${farmParam}::uuid` : '') + (lotId ? ` AND l.id = ${lotParam}::uuid` : '');

  const [expenses, laborLot, laborAlloc, invCons, genAlloc, payAlloc, fixedAlloc] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(e.amount_crc), 0)::numeric(14,2) AS n
       FROM expenses e
       ${lotJoin}
       WHERE e.is_active = true
         AND e.client_id = $1
         AND e.exp_date >= $2::date AND e.exp_date <= $3::date
         ${farmLotFilter}`,
      params
    ),
    pool.query(
      `SELECT COALESCE(SUM(le.amount), 0)::numeric(14,2) AS n
       FROM labor_entries le
       INNER JOIN lots l ON l.id = le.lot_id AND l.client_id = $1
       WHERE le.is_active = true AND le.client_id = $1
         AND le.cost_scope = 'lot'
         AND le.work_date >= $2::date AND le.work_date <= $3::date
         ${SQL_LABOR_EXCLUDE_IF_DAY_COVERED_BY_PAID_PAYROLL}
         ${farmLotFilter}`,
      params
    ),
    pool.query(
      `SELECT COALESCE(SUM(lea.amount_allocated), 0)::numeric(14,2) AS n
       FROM labor_entry_allocations lea
       INNER JOIN labor_entries le ON le.id = lea.labor_entry_id AND le.is_active = true AND le.client_id = $1
       INNER JOIN lots l ON l.id = lea.lot_id AND l.client_id = $1
       WHERE le.cost_scope = 'farm'
         AND le.work_date >= $2::date AND le.work_date <= $3::date
         ${SQL_LABOR_EXCLUDE_IF_DAY_COVERED_BY_PAID_PAYROLL}
         ${farmLotFilter}`,
      params
    ),
    pool.query(
      `SELECT COALESCE(SUM(ic.amount), 0)::numeric(14,2) AS n
       FROM inventory_consumptions ic
       INNER JOIN lots l ON l.id = ic.lot_id AND l.client_id = $1
       WHERE ic.is_active = true
         AND ic.cons_date >= $2::date AND ic.cons_date <= $3::date
         ${farmLotFilter}`,
      params
    ),
    pool.query(
      `SELECT COALESCE(SUM(geo.amount_allocated), 0)::numeric(14,2) AS n
       FROM general_expense_allocations geo
       INNER JOIN general_expenses ge ON ge.id = geo.general_expense_id AND ge.is_active = true AND ge.client_id = $1
       INNER JOIN lots l ON l.id = geo.lot_id AND l.client_id = $1
       WHERE geo.is_active = true
         AND ge.exp_date >= $2::date AND ge.exp_date <= $3::date
         ${farmLotFilter}`,
      params
    ),
    pool.query(
      `SELECT COALESCE(SUM(psla.amount_allocated), 0)::numeric(14,2) AS n
       FROM payroll_slip_lot_allocations psla
       INNER JOIN payroll_slips ps ON ps.id = psla.payroll_slip_id AND ps.client_id = $1
       INNER JOIN lots l ON l.id = psla.lot_id AND l.client_id = $1
       WHERE ps.status = 'pagada'
         AND ps.period_from <= $3::date AND ps.period_to >= $2::date
         ${farmLotFilter.replace(/l\./g, 'l.')}`,
      params
    ),
    pool.query(
      `SELECT COALESCE(SUM(fpa.amount_allocated), 0)::numeric(14,2) AS n
       FROM fixed_payroll_allocations fpa
       INNER JOIN fixed_payroll fp ON fp.id = fpa.fixed_payroll_id AND fp.is_active = true AND fp.is_paid = true
       INNER JOIN workers w ON w.id = fp.worker_id AND w.client_id = $1
       INNER JOIN payroll_periods pp ON pp.id = fp.period_id
       INNER JOIN lots l ON l.id = fpa.lot_id AND l.client_id = $1
       WHERE fpa.is_active = true
         AND fpa.amount_allocated IS NOT NULL
         AND pp.period_month >= date_trunc('month', $2::date)::date
         AND pp.period_month <= date_trunc('month', $3::date)::date
         ${farmLotFilter}`,
      params
    ),
  ]);

  const expensesCrc = Number(expenses.rows[0]?.n || 0);
  const laborLotCrc = Number(laborLot.rows[0]?.n || 0);
  const laborAllocCrc = Number(laborAlloc.rows[0]?.n || 0);
  const inventoryConsumptionCrc = Number(invCons.rows[0]?.n || 0);
  const generalExpenseAllocCrc = Number(genAlloc.rows[0]?.n || 0);
  const payrollSlipAllocCrc = Number(payAlloc.rows[0]?.n || 0);
  const fixedPayrollAllocCrc = Number(fixedAlloc.rows[0]?.n || 0);

  const laborTotalCrc = round2(laborLotCrc + laborAllocCrc);
  const totalDirectCostsCrc = round2(
    expensesCrc +
      laborTotalCrc +
      inventoryConsumptionCrc +
      generalExpenseAllocCrc +
      payrollSlipAllocCrc +
      fixedPayrollAllocCrc +
      assetDepreciationCrc
  );

  return {
    expensesCrc: round2(expensesCrc),
    laborLotCrc: round2(laborLotCrc),
    laborFarmAllocatedCrc: round2(laborAllocCrc),
    laborTotalCrc,
    inventoryConsumptionCrc: round2(inventoryConsumptionCrc),
    generalExpenseAllocCrc: round2(generalExpenseAllocCrc),
    payrollSlipLotAllocCrc: round2(payrollSlipAllocCrc),
    fixedPayrollAllocCrc: round2(fixedPayrollAllocCrc),
    assetDepreciationCrc: round2(assetDepreciationCrc),
    totalDirectCostsCrc,
  };
}

async function getRevenueByLot({ clientId, from, to, farmId, lotId }) {
  const params = [clientId, from, to];
  if (farmId) params.push(farmId);
  if (lotId) params.push(lotId);
  const farmPh = farmId ? '$4' : null;
  const lotPh = lotId ? (farmId ? '$5' : '$4') : null;

  const res = await pool.query(
    `WITH ${sqlLpBase({ paramFrom: '$2', paramTo: '$3', farmPlaceholder: farmPh, lotPlaceholder: lotPh })},
    alloc_rev AS (
      SELECT lpa.lot_id,
             SUM(rv.trev * (lpa.allocation_pct / 100.0))::numeric(14,2) AS revenue
      FROM lp_base b
      INNER JOIN (
        SELECT lot_production_id, SUM(total_amount)::numeric(14,2) AS trev
        FROM lot_production_details
        GROUP BY lot_production_id
      ) rv ON rv.lot_production_id = b.lp_id
      INNER JOIN lot_production_allocations lpa ON lpa.lot_production_id = b.lp_id AND lpa.is_active = true
      INNER JOIN lots l ON l.id = lpa.lot_id AND l.client_id = $1
      GROUP BY lpa.lot_id
    ),
    no_alloc_rev AS (
      SELECT b.header_lot_id AS lot_id,
             SUM(rv.trev)::numeric(14,2) AS revenue
      FROM lp_base b
      INNER JOIN (
        SELECT lot_production_id, SUM(total_amount)::numeric(14,2) AS trev
        FROM lot_production_details
        GROUP BY lot_production_id
      ) rv ON rv.lot_production_id = b.lp_id
      WHERE NOT EXISTS (
        SELECT 1 FROM lot_production_allocations a
        WHERE a.lot_production_id = b.lp_id AND a.is_active = true
      )
      GROUP BY b.header_lot_id
    ),
    merged AS (
      SELECT lot_id, SUM(revenue) AS revenue FROM alloc_rev GROUP BY lot_id
      UNION ALL
      SELECT lot_id, SUM(revenue) AS revenue FROM no_alloc_rev GROUP BY lot_id
    ),
    by_lot AS (
      SELECT lot_id, SUM(revenue)::numeric(14,2) AS revenue FROM merged GROUP BY lot_id
    )
    SELECT bl.lot_id, l.name AS lot_name, f.id AS farm_id, f.name AS farm_name, bl.revenue
    FROM by_lot bl
    INNER JOIN lots l ON l.id = bl.lot_id AND l.client_id = $1
    INNER JOIN farms f ON f.id = l.farm_id AND f.client_id = $1`,
    params
  );

  // Simplificar kg por lote: recalcular en subconsulta limpia
  const kgRes = await pool.query(
    `WITH ${sqlLpBase({ paramFrom: '$2', paramTo: '$3', farmPlaceholder: farmPh, lotPlaceholder: lotPh })},
    alloc_kg AS (
      SELECT lpa.lot_id,
             SUM(dt.tk * (lpa.allocation_pct / 100.0))::numeric(14,3) AS kg
      FROM lp_base b
      INNER JOIN (
        SELECT lot_production_id, SUM(kilos) AS tk
        FROM lot_production_details
        GROUP BY lot_production_id
      ) dt ON dt.lot_production_id = b.lp_id
      INNER JOIN lot_production_allocations lpa ON lpa.lot_production_id = b.lp_id AND lpa.is_active = true
      GROUP BY lpa.lot_id
    ),
    no_alloc_kg AS (
      SELECT b.header_lot_id AS lot_id,
             SUM(dt.tk)::numeric(14,3) AS kg
      FROM lp_base b
      INNER JOIN (
        SELECT lot_production_id, SUM(kilos) AS tk
        FROM lot_production_details
        GROUP BY lot_production_id
      ) dt ON dt.lot_production_id = b.lp_id
      WHERE NOT EXISTS (
        SELECT 1 FROM lot_production_allocations a
        WHERE a.lot_production_id = b.lp_id AND a.is_active = true
      )
      GROUP BY b.header_lot_id
    ),
    merged AS (
      SELECT lot_id, SUM(kg) AS kg FROM alloc_kg GROUP BY lot_id
      UNION ALL
      SELECT lot_id, SUM(kg) AS kg FROM no_alloc_kg GROUP BY lot_id
    )
    SELECT lot_id, SUM(kg)::numeric(14,3) AS kg FROM merged GROUP BY lot_id`,
    params
  );
  const kgMap = new Map(kgRes.rows.map((r) => [String(r.lot_id), Number(r.kg || 0)]));
  return res.rows.map((r) => ({
    lot_id: r.lot_id,
    lot_name: r.lot_name,
    farm_id: r.farm_id,
    farm_name: r.farm_name,
    revenue_crc: round2(Number(r.revenue || 0)),
    kg: round2(kgMap.get(String(r.lot_id)) ?? 0),
  }));
}

async function getCostsByLot({ clientId, from, to, farmId, lotId, assetDepreciationAlloc }) {
  const depAlloc =
    assetDepreciationAlloc ??
    (await getAssetDepreciationAllocByLot({ clientId, from, to, farmId, lotId }));
  const params = [clientId, from, to];
  if (farmId) params.push(farmId);
  if (lotId) params.push(lotId);
  const farmPh = farmId ? '$4' : null;
  const lotPh = lotId ? (farmId ? '$5' : '$4') : null;
  const fl = (farmPh, lotPh) =>
    (farmPh ? ` AND l.farm_id = ${farmPh}::uuid` : '') + (lotPh ? ` AND l.id = ${lotPh}::uuid` : '');

  const mergeSql = (parts) => `
    SELECT lot_id, SUM(amt)::numeric(14,2) AS cost_crc FROM (
      ${parts.join(' UNION ALL ')}
    ) u GROUP BY lot_id
  `;

  const expensePart = `SELECT e.lot_id, e.amount_crc AS amt FROM expenses e
    INNER JOIN lots l ON l.id = e.lot_id AND l.client_id = $1
    WHERE e.is_active AND e.client_id = $1 AND e.exp_date >= $2::date AND e.exp_date <= $3::date ${fl(farmPh, lotPh)}`;

  const laborLotPart = `SELECT le.lot_id, le.amount AS amt FROM labor_entries le
    INNER JOIN lots l ON l.id = le.lot_id AND l.client_id = $1
    WHERE le.is_active AND le.client_id = $1 AND le.cost_scope = 'lot'
      AND le.work_date >= $2::date AND le.work_date <= $3::date
      ${SQL_LABOR_EXCLUDE_IF_DAY_COVERED_BY_PAID_PAYROLL}
      ${fl(farmPh, lotPh)}`;

  const laborAllocPart = `SELECT lea.lot_id, lea.amount_allocated AS amt FROM labor_entry_allocations lea
    INNER JOIN labor_entries le ON le.id = lea.labor_entry_id AND le.is_active AND le.client_id = $1
    INNER JOIN lots l ON l.id = lea.lot_id AND l.client_id = $1
    WHERE le.cost_scope = 'farm' AND le.work_date >= $2::date AND le.work_date <= $3::date
      ${SQL_LABOR_EXCLUDE_IF_DAY_COVERED_BY_PAID_PAYROLL}
      ${fl(farmPh, lotPh)}`;

  const invPart = `SELECT ic.lot_id, ic.amount AS amt FROM inventory_consumptions ic
    INNER JOIN lots l ON l.id = ic.lot_id AND l.client_id = $1
    WHERE ic.is_active AND ic.cons_date >= $2::date AND ic.cons_date <= $3::date ${fl(farmPh, lotPh)}`;

  const genPart = `SELECT geo.lot_id, geo.amount_allocated AS amt FROM general_expense_allocations geo
    INNER JOIN general_expenses ge ON ge.id = geo.general_expense_id AND ge.client_id = $1 AND ge.is_active
    INNER JOIN lots l ON l.id = geo.lot_id AND l.client_id = $1
    WHERE geo.is_active AND ge.exp_date >= $2::date AND ge.exp_date <= $3::date ${fl(farmPh, lotPh)}`;

  const payPart = `SELECT psla.lot_id, psla.amount_allocated AS amt FROM payroll_slip_lot_allocations psla
    INNER JOIN payroll_slips ps ON ps.id = psla.payroll_slip_id AND ps.client_id = $1
    INNER JOIN lots l ON l.id = psla.lot_id AND l.client_id = $1
    WHERE ps.status = 'pagada'
      AND ps.period_from <= $3::date AND ps.period_to >= $2::date ${fl(farmPh, lotPh)}`;

  const fixPart = `SELECT fpa.lot_id, fpa.amount_allocated AS amt FROM fixed_payroll_allocations fpa
    INNER JOIN fixed_payroll fp ON fp.id = fpa.fixed_payroll_id AND fp.is_active AND fp.is_paid
    INNER JOIN workers w ON w.id = fp.worker_id AND w.client_id = $1
    INNER JOIN payroll_periods pp ON pp.id = fp.period_id
    INNER JOIN lots l ON l.id = fpa.lot_id AND l.client_id = $1
    WHERE fpa.is_active AND fpa.amount_allocated IS NOT NULL
      AND pp.period_month >= date_trunc('month', $2::date)::date
      AND pp.period_month <= date_trunc('month', $3::date)::date ${fl(farmPh, lotPh)}`;

  const res = await pool.query(
    mergeSql([expensePart, laborLotPart, laborAllocPart, invPart, genPart, payPart, fixPart]),
    params
  );
  const map = new Map(res.rows.map((r) => [String(r.lot_id), round2(Number(r.cost_crc || 0))]));
  for (const [lotIdKey, amt] of depAlloc.byLot) {
    map.set(lotIdKey, round2((map.get(lotIdKey) || 0) + amt));
  }
  return map;
}

async function getRentabilityByLot({ clientId, from, to, farmId, lotId, assetDepreciationAlloc }) {
  const [revRows, costMap] = await Promise.all([
    getRevenueByLot({ clientId, from, to, farmId, lotId }),
    getCostsByLot({ clientId, from, to, farmId, lotId, assetDepreciationAlloc }),
  ]);

  const lotIds = new Set([
    ...revRows.map((r) => String(r.lot_id)),
    ...[...costMap.keys()],
  ]);

  const meta = await pool.query(
    `SELECT l.id, l.name AS lot_name, l.farm_id, f.name AS farm_name
     FROM lots l
     INNER JOIN farms f ON f.id = l.farm_id AND f.client_id = $1
     WHERE l.client_id = $1 AND l.is_active = true
       AND ($2::uuid IS NULL OR l.farm_id = $2::uuid)
       AND ($3::uuid IS NULL OR l.id = $3::uuid)`,
    [clientId, farmId, lotId]
  );
  const metaMap = new Map(meta.rows.map((r) => [String(r.id), r]));

  const rows = [];
  for (const id of lotIds) {
    const rev = revRows.find((x) => String(x.lot_id) === id);
    const revenue = rev?.revenue_crc ?? 0;
    const kg = rev?.kg ?? 0;
    const cost = costMap.get(id) ?? 0;
    const m = metaMap.get(id);
    if (!m && revenue === 0 && cost === 0) continue;
    const margin = round2(revenue - cost);
    rows.push({
      lot_id: id,
      lot_name: m?.lot_name || rev?.lot_name || 'Lote',
      farm_id: m?.farm_id || rev?.farm_id || null,
      farm_name: m?.farm_name || rev?.farm_name || '—',
      revenue_crc: round2(revenue),
      cost_crc: round2(cost),
      margin_crc: margin,
      kg: round2(kg),
      margin_per_kg_crc: kg > 0 ? round2(margin / kg) : null,
    });
  }
  rows.sort((a, b) => b.margin_crc - a.margin_crc);
  return rows;
}

async function getRentabilityByFarm({ clientId, from, to, farmId, lotId, assetDepreciationAlloc }) {
  const lots = await getRentabilityByLot({ clientId, from, to, farmId, lotId, assetDepreciationAlloc });
  const byFarm = new Map();
  for (const r of lots) {
    const key = r.farm_id ? String(r.farm_id) : r.farm_name;
    if (!byFarm.has(key)) {
      byFarm.set(key, {
        farm_id: r.farm_id,
        farm_name: r.farm_name,
        revenue_crc: 0,
        cost_crc: 0,
        margin_crc: 0,
        kg: 0,
      });
    }
    const agg = byFarm.get(key);
    agg.revenue_crc += r.revenue_crc;
    agg.cost_crc += r.cost_crc;
    agg.margin_crc += r.margin_crc;
    agg.kg += r.kg;
  }
  return [...byFarm.values()]
    .map((f) => ({
      ...f,
      revenue_crc: round2(f.revenue_crc),
      cost_crc: round2(f.cost_crc),
      margin_crc: round2(f.margin_crc),
      kg: round2(f.kg),
      margin_per_kg_crc: f.kg > 0 ? round2(f.margin_crc / f.kg) : null,
    }))
    .sort((a, b) => b.margin_crc - a.margin_crc);
}

async function getInventoryTopConsumed({ clientId, from, to, farmId, lotId, limit = 15 }) {
  const params = [clientId, from, to];
  let idx = 4;
  const farmPh = farmId ? `$${idx++}` : null;
  const lotPh = lotId ? `$${idx++}` : null;
  const limitPh = `$${idx}`;
  if (farmId) params.push(farmId);
  if (lotId) params.push(lotId);
  params.push(limit);
  const fl = (farmPh, lotPh) =>
    (farmPh ? ` AND l.farm_id = ${farmPh}::uuid` : '') + (lotPh ? ` AND l.id = ${lotPh}::uuid` : '');

  const res = await pool.query(
    `SELECT ii.id, ii.name, ii.unit,
            COALESCE(SUM(ic.qty), 0)::numeric(14,3) AS qty,
            COALESCE(SUM(ic.amount), 0)::numeric(14,2) AS amount_crc
     FROM inventory_consumptions ic
     INNER JOIN lots l ON l.id = ic.lot_id AND l.client_id = $1
     INNER JOIN inventory_items ii ON ii.id = ic.item_id AND ii.client_id = $1
     WHERE ic.is_active = true
       AND ic.cons_date >= $2::date AND ic.cons_date <= $3::date
       ${fl(farmPh, lotPh)}
     GROUP BY ii.id, ii.name, ii.unit
     ORDER BY qty DESC
     LIMIT ${limitPh}::int`,
    params
  );
  return res.rows.map((r) => ({
    item_id: r.id,
    name: r.name,
    unit: r.unit,
    qty: round2(Number(r.qty || 0)),
    amount_crc: round2(Number(r.amount_crc || 0)),
  }));
}

async function getInventoryLowStock({ clientId, threshold = 10, limit = 25 }) {
  const res = await pool.query(
    `SELECT ii.id, ii.name, ii.unit,
            COALESCE(SUM(il.qty_remaining), 0)::numeric(14,3) AS qty_remaining
     FROM inventory_items ii
     LEFT JOIN inventory_layers il ON il.item_id = ii.id AND il.is_active = true AND il.client_id = $1
     WHERE ii.client_id = $1 AND ii.is_active = true
     GROUP BY ii.id, ii.name, ii.unit
     HAVING COALESCE(SUM(il.qty_remaining), 0) < $2::numeric
     ORDER BY qty_remaining ASC
     LIMIT $3::int`,
    [clientId, threshold, limit]
  );
  return res.rows.map((r) => ({
    item_id: r.id,
    name: r.name,
    unit: r.unit,
    qty_remaining: round2(Number(r.qty_remaining || 0)),
  }));
}

/**
 * Reparte montos de planilla **variable** (`payroll_slip_lot_allocations`, planilla pagada) y **nómina fija**
 * (`fixed_payroll_allocations` con `fixed_payroll` pagado y activo) entre tipos de labor según la mezcla de
 * montos de jornadas **registradas** del mismo trabajador en el lote y en el tramo [periodo ∩ rango consulta].
 * Si no hay jornadas en ese tramo, todo el monto de esa asignación queda sin tipo (`labor_type_id` null).
 */
async function getLaborPayrollAttributedByLaborType({ clientId, from, to, farmId, lotId }) {
  const params = [clientId, from, to];
  let idx = 4;
  let lotFarmFilter = '';
  if (farmId) {
    lotFarmFilter += ` AND l.farm_id = $${idx}::uuid`;
    params.push(farmId);
    idx += 1;
  }
  if (lotId) {
    lotFarmFilter += ` AND l.id = $${idx}::uuid`;
    params.push(lotId);
    idx += 1;
  }

  const sql = `
    WITH alloc_lots AS (
      SELECT psla.id AS alloc_id,
             psla.lot_id,
             ps.worker_id,
             psla.amount_allocated::numeric AS alloc_amt,
             GREATEST(ps.period_from, $2::date) AS d0,
             LEAST(ps.period_to, $3::date) AS d1
      FROM payroll_slip_lot_allocations psla
      INNER JOIN payroll_slips ps ON ps.id = psla.payroll_slip_id AND ps.client_id = $1
      INNER JOIN lots l ON l.id = psla.lot_id AND l.client_id = $1
      WHERE ps.status = 'pagada'
        AND ps.period_from <= $3::date AND ps.period_to >= $2::date
        AND GREATEST(ps.period_from, $2::date) <= LEAST(ps.period_to, $3::date)
        ${lotFarmFilter}
      UNION ALL
      SELECT fpa.id AS alloc_id,
             fpa.lot_id,
             fp.worker_id,
             fpa.amount_allocated::numeric AS alloc_amt,
             GREATEST(pp.period_month::date, $2::date) AS d0,
             LEAST((pp.period_month::date + INTERVAL '1 month' - INTERVAL '1 day')::date, $3::date) AS d1
      FROM fixed_payroll_allocations fpa
      INNER JOIN fixed_payroll fp ON fp.id = fpa.fixed_payroll_id AND fp.is_active = true AND fp.is_paid = true
      INNER JOIN workers w ON w.id = fp.worker_id AND w.client_id = $1
      INNER JOIN payroll_periods pp ON pp.id = fp.period_id
      INNER JOIN lots l ON l.id = fpa.lot_id AND l.client_id = $1
      WHERE fpa.is_active = true
        AND fpa.amount_allocated IS NOT NULL
        AND COALESCE(fpa.amount_allocated, 0) > 0
        AND pp.period_month >= date_trunc('month', $2::date)::date
        AND pp.period_month <= date_trunc('month', $3::date)::date
        ${lotFarmFilter}
        AND GREATEST(pp.period_month::date, $2::date) <=
            LEAST((pp.period_month::date + INTERVAL '1 month' - INTERVAL '1 day')::date, $3::date)
    ),
    lot_labor AS (
      SELECT al.alloc_id, le.labor_type_id, SUM(le.amount)::numeric AS wt_amt
      FROM alloc_lots al
      INNER JOIN labor_entries le ON le.worker_id = al.worker_id
        AND le.client_id = $1 AND le.is_active = true
        AND le.cost_scope = 'lot' AND le.lot_id = al.lot_id
        AND le.work_date >= al.d0 AND le.work_date <= al.d1
      GROUP BY al.alloc_id, le.labor_type_id
    ),
    farm_labor AS (
      SELECT al.alloc_id, le.labor_type_id, SUM(lea.amount_allocated)::numeric AS wt_amt
      FROM alloc_lots al
      INNER JOIN labor_entry_allocations lea ON lea.lot_id = al.lot_id AND lea.is_active = true
        AND COALESCE(lea.amount_allocated, 0) > 0
      INNER JOIN labor_entries le ON le.id = lea.labor_entry_id
        AND le.worker_id = al.worker_id AND le.client_id = $1 AND le.is_active = true
        AND le.cost_scope = 'farm'
        AND le.work_date >= al.d0 AND le.work_date <= al.d1
      GROUP BY al.alloc_id, le.labor_type_id
    ),
    mix AS (
      SELECT alloc_id, labor_type_id, SUM(wt_amt)::numeric AS wt_amt
      FROM (
        SELECT alloc_id, labor_type_id, wt_amt FROM lot_labor
        UNION ALL
        SELECT alloc_id, labor_type_id, wt_amt FROM farm_labor
      ) u
      GROUP BY alloc_id, labor_type_id
    ),
    alloc_tot AS (
      SELECT alloc_id, SUM(wt_amt)::numeric AS tot_wt FROM mix GROUP BY alloc_id
    ),
    typed AS (
      SELECT m.labor_type_id,
             SUM(al.alloc_amt * m.wt_amt / st.tot_wt)::numeric AS payroll_amt
      FROM mix m
      INNER JOIN alloc_tot st ON st.alloc_id = m.alloc_id AND st.tot_wt > 0
      INNER JOIN alloc_lots al ON al.alloc_id = m.alloc_id
      GROUP BY m.labor_type_id
      HAVING SUM(al.alloc_amt * m.wt_amt / st.tot_wt) <> 0
    ),
    orphan AS (
      SELECT COALESCE(SUM(al.alloc_amt), 0)::numeric AS payroll_amt
      FROM alloc_lots al
      LEFT JOIN alloc_tot st ON st.alloc_id = al.alloc_id
      WHERE COALESCE(st.tot_wt, 0) = 0
    )
    SELECT labor_type_id, payroll_amt FROM typed
    UNION ALL
    SELECT NULL::uuid AS labor_type_id, o.payroll_amt FROM orphan o
    WHERE o.payroll_amt <> 0`;

  const totSql = `
    SELECT (
      COALESCE((
        SELECT SUM(psla.amount_allocated)::numeric
        FROM payroll_slip_lot_allocations psla
        INNER JOIN payroll_slips ps ON ps.id = psla.payroll_slip_id AND ps.client_id = $1
        INNER JOIN lots l ON l.id = psla.lot_id AND l.client_id = $1
        WHERE ps.status = 'pagada'
          AND ps.period_from <= $3::date AND ps.period_to >= $2::date
          ${lotFarmFilter}
      ), 0)
      +
      COALESCE((
        SELECT SUM(fpa.amount_allocated)::numeric
        FROM fixed_payroll_allocations fpa
        INNER JOIN fixed_payroll fp ON fp.id = fpa.fixed_payroll_id AND fp.is_active = true AND fp.is_paid = true
        INNER JOIN workers w ON w.id = fp.worker_id AND w.client_id = $1
        INNER JOIN payroll_periods pp ON pp.id = fp.period_id
        INNER JOIN lots l ON l.id = fpa.lot_id AND l.client_id = $1
        WHERE fpa.is_active = true
          AND fpa.amount_allocated IS NOT NULL
          AND COALESCE(fpa.amount_allocated, 0) > 0
          AND pp.period_month >= date_trunc('month', $2::date)::date
          AND pp.period_month <= date_trunc('month', $3::date)::date
          ${lotFarmFilter}
      ), 0)
    )::numeric(14,2) AS total_alloc`;

  const [byTypeRes, totRes] = await Promise.all([pool.query(sql, params), pool.query(totSql, params)]);

  const totalRef = round2(Number(totRes.rows[0]?.total_alloc || 0));
  const raw = byTypeRes.rows.map((r) => ({
    labor_type_id: r.labor_type_id,
    payroll_amt: Number(r.payroll_amt || 0),
  }));
  const payrollMap = new Map();
  for (const row of raw) {
    const k = row.labor_type_id == null ? '__none__' : String(row.labor_type_id);
    payrollMap.set(k, (payrollMap.get(k) || 0) + row.payroll_amt);
  }
  let sumRounded = 0;
  const roundedEntries = [...payrollMap.entries()].map(([k, v]) => {
    const rv = round2(v);
    sumRounded += rv;
    return [k, rv];
  });
  const diff = round2(totalRef - sumRounded);
  if (Math.abs(diff) >= 0.005 && roundedEntries.length > 0) {
    roundedEntries.sort((a, b) => b[1] - a[1]);
    roundedEntries[0][1] = round2(roundedEntries[0][1] + diff);
  }
  return { payrollByType: new Map(roundedEntries), totalPayrollAllocRef: totalRef };
}

const LABOR_BY_TYPE_NAME_NONE_AMOUNT =
  'Planilla / nómina fija (sin jornadas en el lote en el periodo de la planilla o del mes de nómina)';
const LABOR_BY_TYPE_NAME_NONE_PRESENCE =
  'Planilla / nómina fija (sin registros de labor en el lote en el periodo de la planilla o del mes de nómina)';

/**
 * Igual que `getLaborPayrollAttributedByLaborType`, pero el reparto entre tipos usa **cantidad de registros**
 * de labor del trabajador en el lote y tramo (lote directo + finca con prorrateo a ese lote con % o monto > 0),
 * en lugar de sumar montos de jornada. Así la planilla/nómina fija puede imputarse aunque el registro tenga
 * monto 0. La suma total sigue coincidiendo con planilla variable + nómina fija a lotes.
 */
async function getLaborPayrollAttributedByLaborTypeByLaborPresence({ clientId, from, to, farmId, lotId }) {
  const params = [clientId, from, to];
  let idx = 4;
  let lotFarmFilter = '';
  if (farmId) {
    lotFarmFilter += ` AND l.farm_id = $${idx}::uuid`;
    params.push(farmId);
    idx += 1;
  }
  if (lotId) {
    lotFarmFilter += ` AND l.id = $${idx}::uuid`;
    params.push(lotId);
    idx += 1;
  }

  const sql = `
    WITH alloc_lots AS (
      SELECT psla.id AS alloc_id,
             psla.lot_id,
             ps.worker_id,
             psla.amount_allocated::numeric AS alloc_amt,
             GREATEST(ps.period_from, $2::date) AS d0,
             LEAST(ps.period_to, $3::date) AS d1
      FROM payroll_slip_lot_allocations psla
      INNER JOIN payroll_slips ps ON ps.id = psla.payroll_slip_id AND ps.client_id = $1
      INNER JOIN lots l ON l.id = psla.lot_id AND l.client_id = $1
      WHERE ps.status = 'pagada'
        AND ps.period_from <= $3::date AND ps.period_to >= $2::date
        AND GREATEST(ps.period_from, $2::date) <= LEAST(ps.period_to, $3::date)
        ${lotFarmFilter}
      UNION ALL
      SELECT fpa.id AS alloc_id,
             fpa.lot_id,
             fp.worker_id,
             fpa.amount_allocated::numeric AS alloc_amt,
             GREATEST(pp.period_month::date, $2::date) AS d0,
             LEAST((pp.period_month::date + INTERVAL '1 month' - INTERVAL '1 day')::date, $3::date) AS d1
      FROM fixed_payroll_allocations fpa
      INNER JOIN fixed_payroll fp ON fp.id = fpa.fixed_payroll_id AND fp.is_active = true AND fp.is_paid = true
      INNER JOIN workers w ON w.id = fp.worker_id AND w.client_id = $1
      INNER JOIN payroll_periods pp ON pp.id = fp.period_id
      INNER JOIN lots l ON l.id = fpa.lot_id AND l.client_id = $1
      WHERE fpa.is_active = true
        AND fpa.amount_allocated IS NOT NULL
        AND COALESCE(fpa.amount_allocated, 0) > 0
        AND pp.period_month >= date_trunc('month', $2::date)::date
        AND pp.period_month <= date_trunc('month', $3::date)::date
        ${lotFarmFilter}
        AND GREATEST(pp.period_month::date, $2::date) <=
            LEAST((pp.period_month::date + INTERVAL '1 month' - INTERVAL '1 day')::date, $3::date)
    ),
    lot_presence AS (
      SELECT al.alloc_id, le.labor_type_id, COUNT(DISTINCT le.id)::numeric AS wt_amt
      FROM alloc_lots al
      INNER JOIN labor_entries le ON le.worker_id = al.worker_id
        AND le.client_id = $1 AND le.is_active = true
        AND le.cost_scope = 'lot' AND le.lot_id = al.lot_id
        AND le.work_date >= al.d0 AND le.work_date <= al.d1
      GROUP BY al.alloc_id, le.labor_type_id
    ),
    farm_presence AS (
      SELECT al.alloc_id, le.labor_type_id, COUNT(DISTINCT le.id)::numeric AS wt_amt
      FROM alloc_lots al
      INNER JOIN labor_entry_allocations lea ON lea.lot_id = al.lot_id AND lea.is_active = true
        AND (COALESCE(lea.allocation_pct, 0) > 0 OR COALESCE(lea.amount_allocated, 0) > 0)
      INNER JOIN labor_entries le ON le.id = lea.labor_entry_id
        AND le.worker_id = al.worker_id AND le.client_id = $1 AND le.is_active = true
        AND le.cost_scope = 'farm'
        AND le.work_date >= al.d0 AND le.work_date <= al.d1
      GROUP BY al.alloc_id, le.labor_type_id
    ),
    mix AS (
      SELECT alloc_id, labor_type_id, SUM(wt_amt)::numeric AS wt_amt
      FROM (
        SELECT alloc_id, labor_type_id, wt_amt FROM lot_presence
        UNION ALL
        SELECT alloc_id, labor_type_id, wt_amt FROM farm_presence
      ) u
      GROUP BY alloc_id, labor_type_id
    ),
    alloc_tot AS (
      SELECT alloc_id, SUM(wt_amt)::numeric AS tot_wt FROM mix GROUP BY alloc_id
    ),
    typed AS (
      SELECT m.labor_type_id,
             SUM(al.alloc_amt * m.wt_amt / st.tot_wt)::numeric AS payroll_amt
      FROM mix m
      INNER JOIN alloc_tot st ON st.alloc_id = m.alloc_id AND st.tot_wt > 0
      INNER JOIN alloc_lots al ON al.alloc_id = m.alloc_id
      GROUP BY m.labor_type_id
      HAVING SUM(al.alloc_amt * m.wt_amt / st.tot_wt) <> 0
    ),
    orphan AS (
      SELECT COALESCE(SUM(al.alloc_amt), 0)::numeric AS payroll_amt
      FROM alloc_lots al
      LEFT JOIN alloc_tot st ON st.alloc_id = al.alloc_id
      WHERE COALESCE(st.tot_wt, 0) = 0
    )
    SELECT labor_type_id, payroll_amt FROM typed
    UNION ALL
    SELECT NULL::uuid AS labor_type_id, o.payroll_amt FROM orphan o
    WHERE o.payroll_amt <> 0`;

  const totSql = `
    SELECT (
      COALESCE((
        SELECT SUM(psla.amount_allocated)::numeric
        FROM payroll_slip_lot_allocations psla
        INNER JOIN payroll_slips ps ON ps.id = psla.payroll_slip_id AND ps.client_id = $1
        INNER JOIN lots l ON l.id = psla.lot_id AND l.client_id = $1
        WHERE ps.status = 'pagada'
          AND ps.period_from <= $3::date AND ps.period_to >= $2::date
          ${lotFarmFilter}
      ), 0)
      +
      COALESCE((
        SELECT SUM(fpa.amount_allocated)::numeric
        FROM fixed_payroll_allocations fpa
        INNER JOIN fixed_payroll fp ON fp.id = fpa.fixed_payroll_id AND fp.is_active = true AND fp.is_paid = true
        INNER JOIN workers w ON w.id = fp.worker_id AND w.client_id = $1
        INNER JOIN payroll_periods pp ON pp.id = fp.period_id
        INNER JOIN lots l ON l.id = fpa.lot_id AND l.client_id = $1
        WHERE fpa.is_active = true
          AND fpa.amount_allocated IS NOT NULL
          AND COALESCE(fpa.amount_allocated, 0) > 0
          AND pp.period_month >= date_trunc('month', $2::date)::date
          AND pp.period_month <= date_trunc('month', $3::date)::date
          ${lotFarmFilter}
      ), 0)
    )::numeric(14,2) AS total_alloc`;

  const [byTypeRes, totRes] = await Promise.all([pool.query(sql, params), pool.query(totSql, params)]);

  const totalRef = round2(Number(totRes.rows[0]?.total_alloc || 0));
  const raw = byTypeRes.rows.map((r) => ({
    labor_type_id: r.labor_type_id,
    payroll_amt: Number(r.payroll_amt || 0),
  }));
  const payrollMap = new Map();
  for (const row of raw) {
    const k = row.labor_type_id == null ? '__none__' : String(row.labor_type_id);
    payrollMap.set(k, (payrollMap.get(k) || 0) + row.payroll_amt);
  }
  let sumRounded = 0;
  const roundedEntries = [...payrollMap.entries()].map(([k, v]) => {
    const rv = round2(v);
    sumRounded += rv;
    return [k, rv];
  });
  const diff = round2(totalRef - sumRounded);
  if (Math.abs(diff) >= 0.005 && roundedEntries.length > 0) {
    roundedEntries.sort((a, b) => b[1] - a[1]);
    roundedEntries[0][1] = round2(roundedEntries[0][1] + diff);
  }
  return { payrollByType: new Map(roundedEntries), totalPayrollAllocRef: totalRef };
}

async function queryLaborEntriesByTypeGrossNet({ clientId, from, to, farmId, lotId }) {
  const buildFarmScopeUnallocatedSql = (farmParamIdx, withExclude) => {
    const ex = withExclude ? `\n           ${SQL_LABOR_EXCLUDE_IF_DAY_COVERED_BY_PAID_PAYROLL}` : '';
    if (!farmId || lotId || farmParamIdx == null) return '';
    return `
         UNION ALL
         SELECT le.labor_type_id AS ltid, le.amount AS amt, 1 AS cnt
         FROM labor_entries le
         WHERE le.is_active AND le.client_id = $1 AND le.cost_scope = 'farm'
           AND le.work_date >= $2::date AND le.work_date <= $3::date
           AND le.farm_id = $${farmParamIdx}::uuid
           AND EXISTS (SELECT 1 FROM farms f WHERE f.id = le.farm_id AND f.client_id = $1)${ex}
           AND NOT EXISTS (
             SELECT 1 FROM labor_entry_allocations lea0
             WHERE lea0.labor_entry_id = le.id AND lea0.is_active = true
               AND COALESCE(lea0.amount_allocated, 0) > 0
           )`;
  };

  const runLaborByTypeQuery = (withExclude) => {
    const exL = withExclude ? `\n           ${SQL_LABOR_EXCLUDE_IF_DAY_COVERED_BY_PAID_PAYROLL}` : '';
    const exS = withExclude ? `\n         ${SQL_LABOR_EXCLUDE_IF_DAY_COVERED_BY_PAID_PAYROLL}` : '';
    if (farmId || lotId) {
      const params = [clientId, from, to];
      let idx = 4;
      let farmClause = '';
      let lotClause = '';
      let farmParamIdx = null;
      if (farmId) {
        farmParamIdx = idx;
        farmClause = `AND l.farm_id = $${idx}::uuid`;
        params.push(farmId);
        idx += 1;
      }
      if (lotId) {
        lotClause = `AND l.id = $${idx}::uuid`;
        params.push(lotId);
        idx += 1;
      }
      const farmScopeUnallocatedSql = buildFarmScopeUnallocatedSql(farmParamIdx, withExclude);
      return pool.query(
        `SELECT lt.id, lt.name,
                COALESCE(SUM(x.amt), 0)::numeric(14,2) AS amount_crc,
                SUM(x.cnt)::int AS entries_count
         FROM (
           SELECT le.labor_type_id AS ltid, le.amount AS amt, 1 AS cnt
           FROM labor_entries le
           INNER JOIN lots l ON l.id = le.lot_id AND l.client_id = $1
           WHERE le.is_active AND le.client_id = $1 AND le.cost_scope = 'lot'
             AND le.work_date >= $2::date AND le.work_date <= $3::date${exL}
             ${farmClause}
             ${lotClause}
           UNION ALL
           SELECT le.labor_type_id, lea.amount_allocated, 1
           FROM labor_entries le
           INNER JOIN labor_entry_allocations lea
             ON lea.labor_entry_id = le.id AND lea.is_active = true
           INNER JOIN lots l ON l.id = lea.lot_id AND l.client_id = $1
           WHERE le.is_active AND le.client_id = $1 AND le.cost_scope = 'farm'
             AND le.work_date >= $2::date AND le.work_date <= $3::date${exL}
             ${farmClause}
             ${lotClause}
           ${farmScopeUnallocatedSql}
         ) x
         INNER JOIN labor_types lt ON lt.id = x.ltid
         GROUP BY lt.id, lt.name
         ORDER BY amount_crc DESC`,
        params
      );
    }
    return pool.query(
      `SELECT lt.id, lt.name,
              COALESCE(SUM(x.amt), 0)::numeric(14,2) AS amount_crc,
              SUM(x.cnt)::int AS entries_count
       FROM (
         SELECT le.labor_type_id AS ltid, le.amount AS amt, 1 AS cnt
         FROM labor_entries le
         INNER JOIN lots l ON l.id = le.lot_id AND l.client_id = $1
         WHERE le.is_active AND le.client_id = $1 AND le.cost_scope = 'lot'
           AND le.work_date >= $2::date AND le.work_date <= $3::date${exS}
         UNION ALL
         SELECT le.labor_type_id, lea.amount_allocated, 1
         FROM labor_entries le
         INNER JOIN labor_entry_allocations lea
           ON lea.labor_entry_id = le.id AND lea.is_active = true
         INNER JOIN lots l ON l.id = lea.lot_id AND l.client_id = $1
         WHERE le.is_active AND le.client_id = $1 AND le.cost_scope = 'farm'
           AND le.work_date >= $2::date AND le.work_date <= $3::date${exS}
         UNION ALL
         SELECT le.labor_type_id AS ltid, le.amount AS amt, 1 AS cnt
         FROM labor_entries le
         WHERE le.is_active AND le.client_id = $1 AND le.cost_scope = 'farm'
           AND le.work_date >= $2::date AND le.work_date <= $3::date
           AND EXISTS (SELECT 1 FROM farms f WHERE f.id = le.farm_id AND f.client_id = $1)${exS}
           AND NOT EXISTS (
             SELECT 1 FROM labor_entry_allocations lea0
             WHERE lea0.labor_entry_id = le.id AND lea0.is_active = true
               AND COALESCE(lea0.amount_allocated, 0) > 0
           )
       ) x
       INNER JOIN labor_types lt ON lt.id = x.ltid
       GROUP BY lt.id, lt.name
       ORDER BY amount_crc DESC`,
      [clientId, from, to]
    );
  };

  const [grossRes, netRes] = await Promise.all([runLaborByTypeQuery(false), runLaborByTypeQuery(true)]);
  return { grossRes, netRes };
}

async function finalizeLaborByTypeRows(grossRes, netRes, payrollSplit, orphanRowName) {
  const grossMap = new Map(
    grossRes.rows.map((r) => [
      String(r.id),
      { name: r.name, gross: round2(Number(r.amount_crc || 0)), entries_count: Number(r.entries_count || 0) },
    ])
  );
  const netMap = new Map(netRes.rows.map((r) => [String(r.id), round2(Number(r.amount_crc || 0))]));

  const typeKeys = new Set([...grossMap.keys(), ...netMap.keys()]);
  for (const k of payrollSplit.payrollByType.keys()) {
    if (k !== '__none__') typeKeys.add(k);
  }

  const rows = [];
  for (const tid of typeKeys) {
    const g = grossMap.get(tid);
    const netAmt = netMap.get(tid) || 0;
    const payAmt = payrollSplit.payrollByType.get(tid) || 0;
    if (!g && netAmt === 0 && payAmt === 0) continue;
    rows.push({
      labor_type_id: tid,
      name: g?.name ?? null,
      amount_labor_entries_gross_crc: g?.gross ?? 0,
      amount_labor_entries_net_crc: netAmt,
      amount_from_payroll_crc: payAmt,
      amount_crc: round2(netAmt + payAmt),
      entries_count: g?.entries_count ?? 0,
    });
  }

  const orphanPay = payrollSplit.payrollByType.get('__none__') || 0;
  if (orphanPay !== 0) {
    rows.push({
      labor_type_id: null,
      name: orphanRowName,
      amount_labor_entries_gross_crc: 0,
      amount_labor_entries_net_crc: 0,
      amount_from_payroll_crc: orphanPay,
      amount_crc: orphanPay,
      entries_count: 0,
    });
  }

  const missingNameIds = rows
    .filter((r) => r.labor_type_id != null && r.name == null)
    .map((r) => r.labor_type_id);
  if (missingNameIds.length > 0) {
    const ltRes = await pool.query(`SELECT id, name FROM labor_types WHERE id = ANY($1::uuid[])`, [missingNameIds]);
    const nameById = new Map(ltRes.rows.map((x) => [String(x.id), x.name]));
    for (const r of rows) {
      if (r.labor_type_id != null && r.name == null) {
        r.name = nameById.get(String(r.labor_type_id)) || 'Tipo de labor';
      }
    }
  }

  rows.sort((a, b) => b.amount_crc - a.amount_crc);
  return rows;
}

async function loadLaborByTypeBundle({ clientId, from, to, farmId, lotId }) {
  const { grossRes, netRes } = await queryLaborEntriesByTypeGrossNet({ clientId, from, to, farmId, lotId });
  const ctx = { clientId, from, to, farmId, lotId };
  const [payrollAmount, payrollPresence] = await Promise.all([
    getLaborPayrollAttributedByLaborType(ctx),
    getLaborPayrollAttributedByLaborTypeByLaborPresence(ctx),
  ]);
  const [labor_by_type, labor_by_type_presence_payroll] = await Promise.all([
    finalizeLaborByTypeRows(grossRes, netRes, payrollAmount, LABOR_BY_TYPE_NAME_NONE_AMOUNT),
    finalizeLaborByTypeRows(grossRes, netRes, payrollPresence, LABOR_BY_TYPE_NAME_NONE_PRESENCE),
  ]);
  return { labor_by_type, labor_by_type_presence_payroll };
}

/**
 * Costo por tipo: jornadas **netas** (criterio CRC, sin duplicar con planilla del mismo día/trabajador) +
 * planilla **variable** y **nómina fija** pagadas a lotes atribuidas a cada tipo según la mezcla de jornadas
 * registradas en el periodo de la planilla o en el mes de nómina fija en ese lote. La suma de `amount_crc` coincide
 * con labor_CRC + planilla variable a lotes + nómina fija a lotes del periodo.
 * `amount_labor_entries_gross_crc` conserva la vista de montos registrados en jornadas (sin exclusión).
 */
async function getLaborByType({ clientId, from, to, farmId, lotId }) {
  const { grossRes, netRes } = await queryLaborEntriesByTypeGrossNet({ clientId, from, to, farmId, lotId });
  const payrollSplit = await getLaborPayrollAttributedByLaborType({ clientId, from, to, farmId, lotId });
  return finalizeLaborByTypeRows(grossRes, netRes, payrollSplit, LABOR_BY_TYPE_NAME_NONE_AMOUNT);
}

async function getHarvestKgBuckets({ clientId, from, to, farmId, lotId, bucket }) {
  const trunc = bucket === 'month' ? 'month' : 'week';
  const farmPh = farmId ? '$4' : null;
  const lotPh = lotId ? (farmId ? '$5' : '$4') : null;
  const params = [clientId, from, to];
  if (farmId) params.push(farmId);
  if (lotId) params.push(lotId);
  const res = await pool.query(
    `WITH ${sqlLpBase({ paramFrom: '$2', paramTo: '$3', farmPlaceholder: farmPh, lotPlaceholder: lotPh })}
    SELECT date_trunc('${trunc}', lp.prod_date)::date AS period_start,
           COALESCE(SUM(lpd.kilos), 0)::numeric(14,3) AS kg
     FROM lp_base b
     INNER JOIN lot_production lp ON lp.id = b.lp_id
     INNER JOIN lot_production_details lpd ON lpd.lot_production_id = lp.id
     GROUP BY 1
     ORDER BY 1`,
    params
  );
  return res.rows.map((r) => ({
    period_start: r.period_start,
    kg: round2(Number(r.kg || 0)),
  }));
}

async function getProductionKgByCaliber({ clientId, from, to, farmId, lotId }) {
  const farmPh = farmId ? '$4' : null;
  const lotPh = lotId ? (farmId ? '$5' : '$4') : null;
  const params = [clientId, from, to];
  if (farmId) params.push(farmId);
  if (lotId) params.push(lotId);
  const res = await pool.query(
    `WITH ${sqlLpBase({ paramFrom: '$2', paramTo: '$3', farmPlaceholder: farmPh, lotPlaceholder: lotPh })}
    SELECT c.id AS caliber_id,
           c.name AS caliber_name,
           COALESCE(SUM(lpd.kilos), 0)::numeric(14,3) AS kg
     FROM lp_base b
     INNER JOIN lot_production lp ON lp.id = b.lp_id
     INNER JOIN lot_production_details lpd ON lpd.lot_production_id = lp.id
     INNER JOIN calibers c ON c.id = lpd.caliber_id
     GROUP BY c.id, c.name
     ORDER BY kg DESC`,
    params
  );
  return res.rows.map((r) => ({
    caliber_id: r.caliber_id,
    caliber_name: r.caliber_name,
    kg: round2(Number(r.kg || 0)),
  }));
}

async function getDirectExpensesByLot({ clientId, from, to, farmId, lotId }) {
  const params = [clientId, from, to];
  if (farmId) params.push(farmId);
  if (lotId) params.push(lotId);
  const farmPh = farmId ? '$4' : null;
  const lotPh = lotId ? (farmId ? '$5' : '$4') : null;
  const fl = (farmPh, lotPh) =>
    (farmPh ? ` AND l.farm_id = ${farmPh}::uuid` : '') + (lotPh ? ` AND l.id = ${lotPh}::uuid` : '');
  const res = await pool.query(
    `SELECT l.id AS lot_id,
            l.name AS lot_name,
            f.id AS farm_id,
            f.name AS farm_name,
            COALESCE(SUM(e.amount_crc), 0)::numeric(14,2) AS amount_crc
     FROM expenses e
     INNER JOIN lots l ON l.id = e.lot_id AND l.client_id = $1
     INNER JOIN farms f ON f.id = l.farm_id AND f.client_id = $1
     WHERE e.is_active = true
       AND e.client_id = $1
       AND e.exp_date >= $2::date AND e.exp_date <= $3::date
       ${fl(farmPh, lotPh)}
     GROUP BY l.id, l.name, f.id, f.name
     HAVING COALESCE(SUM(e.amount_crc), 0) > 0
     ORDER BY amount_crc DESC`,
    params
  );
  return res.rows.map((r) => ({
    lot_id: r.lot_id,
    lot_name: r.lot_name,
    farm_id: r.farm_id,
    farm_name: r.farm_name,
    amount_crc: round2(Number(r.amount_crc || 0)),
  }));
}

async function getInventoryConsumedByItemLot({ clientId, from, to, farmId, lotId, limit = 40 }) {
  const params = [clientId, from, to];
  let idx = 4;
  const farmPh = farmId ? `$${idx++}` : null;
  const lotPh = lotId ? `$${idx++}` : null;
  const limitPh = `$${idx}`;
  if (farmId) params.push(farmId);
  if (lotId) params.push(lotId);
  params.push(limit);
  const fl = (farmPh, lotPh) =>
    (farmPh ? ` AND l.farm_id = ${farmPh}::uuid` : '') + (lotPh ? ` AND l.id = ${lotPh}::uuid` : '');
  const res = await pool.query(
    `SELECT ii.id AS item_id,
            ii.name AS item_name,
            ii.unit AS item_unit,
            l.id AS lot_id,
            l.name AS lot_name,
            f.name AS farm_name,
            COALESCE(SUM(ic.qty), 0)::numeric(14,3) AS qty,
            COALESCE(SUM(ic.amount), 0)::numeric(14,2) AS amount_crc
     FROM inventory_consumptions ic
     INNER JOIN lots l ON l.id = ic.lot_id AND l.client_id = $1
     INNER JOIN farms f ON f.id = l.farm_id AND f.client_id = $1
     INNER JOIN inventory_items ii ON ii.id = ic.item_id AND ii.client_id = $1
     WHERE ic.is_active = true
       AND ic.cons_date >= $2::date AND ic.cons_date <= $3::date
       ${fl(farmPh, lotPh)}
     GROUP BY ii.id, ii.name, ii.unit, l.id, l.name, f.name
     ORDER BY amount_crc DESC
     LIMIT ${limitPh}::int`,
    params
  );
  return res.rows.map((r) => ({
    item_id: r.item_id,
    item_name: r.item_name,
    item_unit: r.item_unit,
    lot_id: r.lot_id,
    lot_name: r.lot_name,
    farm_name: r.farm_name,
    qty: round2(Number(r.qty || 0)),
    amount_crc: round2(Number(r.amount_crc || 0)),
  }));
}

/** Serie temporal de gasto en jornadas; misma base bruta que `getLaborByType` (sin exclusión por planilla). */
async function getLaborSpendByBucket({ clientId, from, to, farmId, lotId, bucket }) {
  const trunc = bucket === 'year' ? 'year' : bucket === 'week' ? 'week' : 'month';
  if (farmId || lotId) {
    const params = [clientId, from, to];
    let idx = 4;
    let farmClause = '';
    let lotClause = '';
    let farmParamIdx = null;
    if (farmId) {
      farmParamIdx = idx;
      farmClause = `AND l.farm_id = $${idx}::uuid`;
      params.push(farmId);
      idx += 1;
    }
    if (lotId) {
      lotClause = `AND l.id = $${idx}::uuid`;
      params.push(lotId);
      idx += 1;
    }
    const farmScopeUnallocatedSql =
      farmId && !lotId && farmParamIdx != null
        ? `
         UNION ALL
         SELECT date_trunc('${trunc}', le.work_date)::date AS d, le.amount AS amt
         FROM labor_entries le
         WHERE le.is_active AND le.client_id = $1
           AND le.cost_scope = 'farm'
           AND le.work_date >= $2::date AND le.work_date <= $3::date
           AND le.farm_id = $${farmParamIdx}::uuid
           AND EXISTS (SELECT 1 FROM farms f WHERE f.id = le.farm_id AND f.client_id = $1)
           AND NOT EXISTS (
             SELECT 1 FROM labor_entry_allocations lea0
             WHERE lea0.labor_entry_id = le.id AND lea0.is_active = true
               AND COALESCE(lea0.amount_allocated, 0) > 0
           )`
        : '';
    const res = await pool.query(
      `SELECT d AS period_start, COALESCE(SUM(amt), 0)::numeric(14,2) AS amount_crc
       FROM (
         SELECT date_trunc('${trunc}', le.work_date)::date AS d, le.amount AS amt
         FROM labor_entries le
         INNER JOIN lots l ON l.id = le.lot_id AND l.client_id = $1
         WHERE le.is_active AND le.client_id = $1 AND le.cost_scope = 'lot'
           AND le.work_date >= $2::date AND le.work_date <= $3::date
           ${farmClause}
           ${lotClause}
         UNION ALL
         SELECT date_trunc('${trunc}', le.work_date)::date AS d, lea.amount_allocated AS amt
         FROM labor_entries le
         INNER JOIN labor_entry_allocations lea
           ON lea.labor_entry_id = le.id AND lea.is_active = true
         INNER JOIN lots l ON l.id = lea.lot_id AND l.client_id = $1
         WHERE le.is_active AND le.client_id = $1 AND le.cost_scope = 'farm'
           AND le.work_date >= $2::date AND le.work_date <= $3::date
           ${farmClause}
           ${lotClause}
         ${farmScopeUnallocatedSql}
       ) z
       GROUP BY d
       ORDER BY d`,
      params
    );
    return res.rows.map((r) => ({
      period_start: r.period_start,
      amount_crc: round2(Number(r.amount_crc || 0)),
    }));
  }

  const resAll = await pool.query(
    `SELECT d AS period_start, COALESCE(SUM(amt), 0)::numeric(14,2) AS amount_crc
     FROM (
       SELECT date_trunc('${trunc}', le.work_date)::date AS d, le.amount AS amt
       FROM labor_entries le
       INNER JOIN lots l ON l.id = le.lot_id AND l.client_id = $1
       WHERE le.is_active AND le.client_id = $1 AND le.cost_scope = 'lot'
         AND le.work_date >= $2::date AND le.work_date <= $3::date
       UNION ALL
       SELECT date_trunc('${trunc}', le.work_date)::date AS d, lea.amount_allocated AS amt
       FROM labor_entries le
       INNER JOIN labor_entry_allocations lea
         ON lea.labor_entry_id = le.id AND lea.is_active = true
       INNER JOIN lots l ON l.id = lea.lot_id AND l.client_id = $1
       WHERE le.is_active AND le.client_id = $1 AND le.cost_scope = 'farm'
         AND le.work_date >= $2::date AND le.work_date <= $3::date
       UNION ALL
       SELECT date_trunc('${trunc}', le.work_date)::date AS d, le.amount AS amt
       FROM labor_entries le
       WHERE le.is_active AND le.client_id = $1 AND le.cost_scope = 'farm'
         AND le.work_date >= $2::date AND le.work_date <= $3::date
         AND EXISTS (SELECT 1 FROM farms f WHERE f.id = le.farm_id AND f.client_id = $1)
         AND NOT EXISTS (
           SELECT 1 FROM labor_entry_allocations lea0
           WHERE lea0.labor_entry_id = le.id AND lea0.is_active = true
             AND COALESCE(lea0.amount_allocated, 0) > 0
         )
     ) z
     GROUP BY d
     ORDER BY d`,
    [clientId, from, to]
  );
  return resAll.rows.map((r) => ({
    period_start: r.period_start,
    amount_crc: round2(Number(r.amount_crc || 0)),
  }));
}

const WORKER_JOIN_OCASIONAL =
  "INNER JOIN workers w ON w.id = le.worker_id AND w.client_id = le.client_id AND w.worker_type = 'ocasional'::public.worker_type";

/**
 * Monto CRC por tipo de labor solo para trabajadores **ocasionales**, sumando únicamente montos de
 * `labor_entries` (lote, finca con prorrateo o finca sin asignación): **no** resta ni sustituye por
 * planilla pagada; solo filas con monto distinto de cero. No incluye planilla ni nómina fija.
 */
async function getLaborCostByTypeOccasionalOnly({ clientId, from, to, farmId, lotId }) {
  const buildFarmScopeUnallocatedSql = (farmParamIdx) => {
    if (!farmId || lotId || farmParamIdx == null) return '';
    return `
         UNION ALL
         SELECT le.labor_type_id AS ltid, le.amount AS amt
         FROM labor_entries le
         ${WORKER_JOIN_OCASIONAL}
         WHERE le.is_active AND le.client_id = $1 AND le.cost_scope = 'farm'
           AND le.work_date >= $2::date AND le.work_date <= $3::date
           AND le.farm_id = $${farmParamIdx}::uuid
           AND EXISTS (SELECT 1 FROM farms f WHERE f.id = le.farm_id AND f.client_id = $1)
           AND COALESCE(le.amount, 0) <> 0
           AND NOT EXISTS (
             SELECT 1 FROM labor_entry_allocations lea0
             WHERE lea0.labor_entry_id = le.id AND lea0.is_active = true
               AND COALESCE(lea0.amount_allocated, 0) > 0
           )`;
  };

  let res;
  if (farmId || lotId) {
    const params = [clientId, from, to];
    let idx = 4;
    let farmClause = '';
    let lotClause = '';
    let farmParamIdx = null;
    if (farmId) {
      farmParamIdx = idx;
      farmClause = `AND l.farm_id = $${idx}::uuid`;
      params.push(farmId);
      idx += 1;
    }
    if (lotId) {
      lotClause = `AND l.id = $${idx}::uuid`;
      params.push(lotId);
      idx += 1;
    }
    const farmScopeUnallocatedSql = buildFarmScopeUnallocatedSql(farmParamIdx);
    res = await pool.query(
      `SELECT lt.id AS labor_type_id, lt.name,
              COALESCE(SUM(x.amt), 0)::numeric(14,2) AS amount_crc
       FROM (
         SELECT le.labor_type_id AS ltid, le.amount AS amt
         FROM labor_entries le
         ${WORKER_JOIN_OCASIONAL}
         INNER JOIN lots l ON l.id = le.lot_id AND l.client_id = $1
         WHERE le.is_active AND le.client_id = $1 AND le.cost_scope = 'lot'
           AND le.work_date >= $2::date AND le.work_date <= $3::date
           AND COALESCE(le.amount, 0) <> 0
           ${farmClause}
           ${lotClause}
         UNION ALL
         SELECT le.labor_type_id, lea.amount_allocated
         FROM labor_entries le
         ${WORKER_JOIN_OCASIONAL}
         INNER JOIN labor_entry_allocations lea
           ON lea.labor_entry_id = le.id AND lea.is_active = true
         INNER JOIN lots l ON l.id = lea.lot_id AND l.client_id = $1
         WHERE le.is_active AND le.client_id = $1 AND le.cost_scope = 'farm'
           AND le.work_date >= $2::date AND le.work_date <= $3::date
           AND COALESCE(lea.amount_allocated, 0) <> 0
           ${farmClause}
           ${lotClause}
         ${farmScopeUnallocatedSql}
       ) x
       INNER JOIN labor_types lt ON lt.id = x.ltid
       GROUP BY lt.id, lt.name
       HAVING COALESCE(SUM(x.amt), 0) <> 0
       ORDER BY amount_crc DESC`,
      params
    );
  } else {
    res = await pool.query(
      `SELECT lt.id AS labor_type_id, lt.name,
              COALESCE(SUM(x.amt), 0)::numeric(14,2) AS amount_crc
       FROM (
         SELECT le.labor_type_id AS ltid, le.amount AS amt
         FROM labor_entries le
         ${WORKER_JOIN_OCASIONAL}
         INNER JOIN lots l ON l.id = le.lot_id AND l.client_id = $1
         WHERE le.is_active AND le.client_id = $1 AND le.cost_scope = 'lot'
           AND le.work_date >= $2::date AND le.work_date <= $3::date
           AND COALESCE(le.amount, 0) <> 0
         UNION ALL
         SELECT le.labor_type_id, lea.amount_allocated
         FROM labor_entries le
         ${WORKER_JOIN_OCASIONAL}
         INNER JOIN labor_entry_allocations lea
           ON lea.labor_entry_id = le.id AND lea.is_active = true
         INNER JOIN lots l ON l.id = lea.lot_id AND l.client_id = $1
         WHERE le.is_active AND le.client_id = $1 AND le.cost_scope = 'farm'
           AND le.work_date >= $2::date AND le.work_date <= $3::date
           AND COALESCE(lea.amount_allocated, 0) <> 0
         UNION ALL
         SELECT le.labor_type_id AS ltid, le.amount AS amt
         FROM labor_entries le
         ${WORKER_JOIN_OCASIONAL}
         WHERE le.is_active AND le.client_id = $1 AND le.cost_scope = 'farm'
           AND le.work_date >= $2::date AND le.work_date <= $3::date
           AND EXISTS (SELECT 1 FROM farms f WHERE f.id = le.farm_id AND f.client_id = $1)
           AND COALESCE(le.amount, 0) <> 0
           AND NOT EXISTS (
             SELECT 1 FROM labor_entry_allocations lea0
             WHERE lea0.labor_entry_id = le.id AND lea0.is_active = true
               AND COALESCE(lea0.amount_allocated, 0) > 0
           )
       ) x
       INNER JOIN labor_types lt ON lt.id = x.ltid
       GROUP BY lt.id, lt.name
       HAVING COALESCE(SUM(x.amt), 0) <> 0
       ORDER BY amount_crc DESC`,
      [clientId, from, to]
    );
  }

  return res.rows.map((r) => ({
    labor_type_id: r.labor_type_id,
    name: r.name,
    amount_crc: round2(Number(r.amount_crc || 0)),
  }));
}

/**
 * Cuántas veces se registró cada tipo de labor (todos los trabajadores: fijos, ocasionales, etc.).
 * Cuenta filas de `labor_entries` distintas que caen en el mismo alcance geográfico que las estadísticas de labor.
 */
async function getLaborTypeRegistrationCounts({ clientId, from, to, farmId, lotId }) {
  const buildFarmScopeUnallocatedSql = (farmParamIdx) => {
    if (!farmId || lotId || farmParamIdx == null) return '';
    return `
         UNION ALL
         SELECT le.id AS eid, le.labor_type_id AS ltid
         FROM labor_entries le
         INNER JOIN workers w ON w.id = le.worker_id AND w.client_id = le.client_id
         WHERE le.is_active AND le.client_id = $1 AND le.cost_scope = 'farm'
           AND le.work_date >= $2::date AND le.work_date <= $3::date
           AND le.farm_id = $${farmParamIdx}::uuid
           AND EXISTS (SELECT 1 FROM farms f WHERE f.id = le.farm_id AND f.client_id = $1)
           AND NOT EXISTS (
             SELECT 1 FROM labor_entry_allocations lea0
             WHERE lea0.labor_entry_id = le.id AND lea0.is_active = true
               AND COALESCE(lea0.amount_allocated, 0) > 0
           )`;
  };

  let res;
  if (farmId || lotId) {
    const params = [clientId, from, to];
    let idx = 4;
    let farmClause = '';
    let lotClause = '';
    let farmParamIdx = null;
    if (farmId) {
      farmParamIdx = idx;
      farmClause = `AND l.farm_id = $${idx}::uuid`;
      params.push(farmId);
      idx += 1;
    }
    if (lotId) {
      lotClause = `AND l.id = $${idx}::uuid`;
      params.push(lotId);
      idx += 1;
    }
    const farmScopeUnallocatedSql = buildFarmScopeUnallocatedSql(farmParamIdx);
    res = await pool.query(
      `SELECT lt.id AS labor_type_id, lt.name,
              COUNT(DISTINCT x.eid)::int AS registrations_count
       FROM (
         SELECT le.id AS eid, le.labor_type_id AS ltid
         FROM labor_entries le
         INNER JOIN workers w ON w.id = le.worker_id AND w.client_id = le.client_id
         INNER JOIN lots l ON l.id = le.lot_id AND l.client_id = $1
         WHERE le.is_active AND le.client_id = $1 AND le.cost_scope = 'lot'
           AND le.work_date >= $2::date AND le.work_date <= $3::date
           ${farmClause}
           ${lotClause}
         UNION ALL
         SELECT le.id, le.labor_type_id
         FROM labor_entries le
         INNER JOIN workers w ON w.id = le.worker_id AND w.client_id = le.client_id
         INNER JOIN labor_entry_allocations lea
           ON lea.labor_entry_id = le.id AND lea.is_active = true
         INNER JOIN lots l ON l.id = lea.lot_id AND l.client_id = $1
         WHERE le.is_active AND le.client_id = $1 AND le.cost_scope = 'farm'
           AND le.work_date >= $2::date AND le.work_date <= $3::date
           ${farmClause}
           ${lotClause}
         ${farmScopeUnallocatedSql}
       ) x
       INNER JOIN labor_types lt ON lt.id = x.ltid
       GROUP BY lt.id, lt.name
       ORDER BY registrations_count DESC`,
      params
    );
  } else {
    res = await pool.query(
      `SELECT lt.id AS labor_type_id, lt.name,
              COUNT(DISTINCT x.eid)::int AS registrations_count
       FROM (
         SELECT le.id AS eid, le.labor_type_id AS ltid
         FROM labor_entries le
         INNER JOIN workers w ON w.id = le.worker_id AND w.client_id = le.client_id
         INNER JOIN lots l ON l.id = le.lot_id AND l.client_id = $1
         WHERE le.is_active AND le.client_id = $1 AND le.cost_scope = 'lot'
           AND le.work_date >= $2::date AND le.work_date <= $3::date
         UNION ALL
         SELECT le.id, le.labor_type_id
         FROM labor_entries le
         INNER JOIN workers w ON w.id = le.worker_id AND w.client_id = le.client_id
         INNER JOIN labor_entry_allocations lea
           ON lea.labor_entry_id = le.id AND lea.is_active = true
         INNER JOIN lots l ON l.id = lea.lot_id AND l.client_id = $1
         WHERE le.is_active AND le.client_id = $1 AND le.cost_scope = 'farm'
           AND le.work_date >= $2::date AND le.work_date <= $3::date
         UNION ALL
         SELECT le.id AS eid, le.labor_type_id AS ltid
         FROM labor_entries le
         INNER JOIN workers w ON w.id = le.worker_id AND w.client_id = le.client_id
         WHERE le.is_active AND le.client_id = $1 AND le.cost_scope = 'farm'
           AND le.work_date >= $2::date AND le.work_date <= $3::date
           AND EXISTS (SELECT 1 FROM farms f WHERE f.id = le.farm_id AND f.client_id = $1)
           AND NOT EXISTS (
             SELECT 1 FROM labor_entry_allocations lea0
             WHERE lea0.labor_entry_id = le.id AND lea0.is_active = true
               AND COALESCE(lea0.amount_allocated, 0) > 0
           )
       ) x
       INNER JOIN labor_types lt ON lt.id = x.ltid
       GROUP BY lt.id, lt.name
       ORDER BY registrations_count DESC`,
      [clientId, from, to]
    );
  }

  return res.rows.map((r) => ({
    labor_type_id: r.labor_type_id,
    name: r.name,
    registrations_count: Number(r.registrations_count || 0),
  }));
}

/** Serie temporal de montos de jornadas solo trabajadores ocasionales (sin exclusión planilla). */
async function getLaborSpendByBucketOccasional({ clientId, from, to, farmId, lotId, bucket }) {
  const trunc = bucket === 'year' ? 'year' : bucket === 'week' ? 'week' : 'month';
  if (farmId || lotId) {
    const params = [clientId, from, to];
    let idx = 4;
    let farmClause = '';
    let lotClause = '';
    let farmParamIdx = null;
    if (farmId) {
      farmParamIdx = idx;
      farmClause = `AND l.farm_id = $${idx}::uuid`;
      params.push(farmId);
      idx += 1;
    }
    if (lotId) {
      lotClause = `AND l.id = $${idx}::uuid`;
      params.push(lotId);
      idx += 1;
    }
    const farmScopeUnallocatedSql =
      farmId && !lotId && farmParamIdx != null
        ? `
         UNION ALL
         SELECT date_trunc('${trunc}', le.work_date)::date AS d, le.amount AS amt
         FROM labor_entries le
         ${WORKER_JOIN_OCASIONAL}
         WHERE le.is_active AND le.client_id = $1
           AND le.cost_scope = 'farm'
           AND le.work_date >= $2::date AND le.work_date <= $3::date
           AND le.farm_id = $${farmParamIdx}::uuid
           AND EXISTS (SELECT 1 FROM farms f WHERE f.id = le.farm_id AND f.client_id = $1)
           AND NOT EXISTS (
             SELECT 1 FROM labor_entry_allocations lea0
             WHERE lea0.labor_entry_id = le.id AND lea0.is_active = true
               AND COALESCE(lea0.amount_allocated, 0) > 0
           )`
        : '';
    const res = await pool.query(
      `SELECT d AS period_start, COALESCE(SUM(amt), 0)::numeric(14,2) AS amount_crc
       FROM (
         SELECT date_trunc('${trunc}', le.work_date)::date AS d, le.amount AS amt
         FROM labor_entries le
         ${WORKER_JOIN_OCASIONAL}
         INNER JOIN lots l ON l.id = le.lot_id AND l.client_id = $1
         WHERE le.is_active AND le.client_id = $1 AND le.cost_scope = 'lot'
           AND le.work_date >= $2::date AND le.work_date <= $3::date
           ${farmClause}
           ${lotClause}
         UNION ALL
         SELECT date_trunc('${trunc}', le.work_date)::date AS d, lea.amount_allocated AS amt
         FROM labor_entries le
         ${WORKER_JOIN_OCASIONAL}
         INNER JOIN labor_entry_allocations lea
           ON lea.labor_entry_id = le.id AND lea.is_active = true
         INNER JOIN lots l ON l.id = lea.lot_id AND l.client_id = $1
         WHERE le.is_active AND le.client_id = $1 AND le.cost_scope = 'farm'
           AND le.work_date >= $2::date AND le.work_date <= $3::date
           ${farmClause}
           ${lotClause}
         ${farmScopeUnallocatedSql}
       ) z
       GROUP BY d
       ORDER BY d`,
      params
    );
    return res.rows.map((r) => ({
      period_start: r.period_start,
      amount_crc: round2(Number(r.amount_crc || 0)),
    }));
  }

  const resAll = await pool.query(
    `SELECT d AS period_start, COALESCE(SUM(amt), 0)::numeric(14,2) AS amount_crc
     FROM (
       SELECT date_trunc('${trunc}', le.work_date)::date AS d, le.amount AS amt
       FROM labor_entries le
       ${WORKER_JOIN_OCASIONAL}
       INNER JOIN lots l ON l.id = le.lot_id AND l.client_id = $1
       WHERE le.is_active AND le.client_id = $1 AND le.cost_scope = 'lot'
         AND le.work_date >= $2::date AND le.work_date <= $3::date
       UNION ALL
       SELECT date_trunc('${trunc}', le.work_date)::date AS d, lea.amount_allocated AS amt
       FROM labor_entries le
       ${WORKER_JOIN_OCASIONAL}
       INNER JOIN labor_entry_allocations lea
         ON lea.labor_entry_id = le.id AND lea.is_active = true
       INNER JOIN lots l ON l.id = lea.lot_id AND l.client_id = $1
       WHERE le.is_active AND le.client_id = $1 AND le.cost_scope = 'farm'
         AND le.work_date >= $2::date AND le.work_date <= $3::date
       UNION ALL
       SELECT date_trunc('${trunc}', le.work_date)::date AS d, le.amount AS amt
       FROM labor_entries le
       ${WORKER_JOIN_OCASIONAL}
       WHERE le.is_active AND le.client_id = $1 AND le.cost_scope = 'farm'
         AND le.work_date >= $2::date AND le.work_date <= $3::date
         AND EXISTS (SELECT 1 FROM farms f WHERE f.id = le.farm_id AND f.client_id = $1)
         AND NOT EXISTS (
           SELECT 1 FROM labor_entry_allocations lea0
           WHERE lea0.labor_entry_id = le.id AND lea0.is_active = true
             AND COALESCE(lea0.amount_allocated, 0) > 0
         )
     ) z
     GROUP BY d
     ORDER BY d`,
    [clientId, from, to]
  );
  return resAll.rows.map((r) => ({
    period_start: r.period_start,
    amount_crc: round2(Number(r.amount_crc || 0)),
  }));
}

async function getLotAreasMap({ clientId, farmId, lotId }) {
  const res = await pool.query(
    `SELECT l.id, l.area_ha
     FROM lots l
     WHERE l.client_id = $1 AND l.is_active = true
       AND ($2::uuid IS NULL OR l.farm_id = $2::uuid)
       AND ($3::uuid IS NULL OR l.id = $3::uuid)`,
    [clientId, farmId, lotId]
  );
  return new Map(res.rows.map((r) => [String(r.id), r.area_ha != null ? Number(r.area_ha) : null]));
}

function buildYieldByLot(rentLots, areaMap) {
  return rentLots.map((r) => {
    const ha = areaMap.get(String(r.lot_id));
    const kg = Number(r.kg || 0);
    const kgPerHa = ha != null && ha > 0 && kg > 0 ? round2(kg / ha) : null;
    return {
      lot_id: r.lot_id,
      lot_name: r.lot_name,
      farm_id: r.farm_id,
      farm_name: r.farm_name,
      kg: round2(kg),
      area_ha: ha != null && ha > 0 ? round2(ha) : null,
      kg_per_ha: kgPerHa,
    };
  });
}

function buildYieldByFarm(rentLots, areaMap) {
  const byFarm = new Map();
  for (const r of rentLots) {
    const key = r.farm_id ? String(r.farm_id) : r.farm_name;
    const ha = areaMap.get(String(r.lot_id));
    const kg = Number(r.kg || 0);
    if (!byFarm.has(key)) {
      byFarm.set(key, {
        farm_id: r.farm_id,
        farm_name: r.farm_name,
        kg: 0,
        area_ha: 0,
      });
    }
    const agg = byFarm.get(key);
    agg.kg += kg;
    if (ha != null && ha > 0) agg.area_ha += ha;
  }
  return [...byFarm.values()]
    .map((f) => ({
      farm_id: f.farm_id,
      farm_name: f.farm_name,
      kg: round2(f.kg),
      area_ha: f.area_ha > 0 ? round2(f.area_ha) : null,
      kg_per_ha:
        f.area_ha > 0 && f.kg > 0 ? round2(f.kg / f.area_ha) : null,
    }))
    .sort((a, b) => (b.kg_per_ha || 0) - (a.kg_per_ha || 0));
}

async function getExpensesByCategory({ clientId, from, to, farmId, lotId }) {
  const params = [clientId, from, to];
  if (farmId) params.push(farmId);
  if (lotId) params.push(lotId);
  const farmPh = farmId ? '$4' : null;
  const lotPh = lotId ? (farmId ? '$5' : '$4') : null;
  const fl = (farmPh, lotPh) =>
    (farmPh ? ` AND l.farm_id = ${farmPh}::uuid` : '') + (lotPh ? ` AND l.id = ${lotPh}::uuid` : '');

  const res = await pool.query(
    `SELECT COALESCE(NULLIF(TRIM(ec.name), ''), 'Sin categoría') AS category,
            COALESCE(SUM(e.amount_crc), 0)::numeric(14,2) AS amount_crc
     FROM expenses e
     INNER JOIN expense_categories ec ON ec.id = e.category_id AND ec.client_id = $1
     INNER JOIN lots l ON l.id = e.lot_id AND l.client_id = $1
     WHERE e.is_active = true
       AND e.client_id = $1
       AND e.exp_date >= $2::date AND e.exp_date <= $3::date
       ${fl(farmPh, lotPh)}
     GROUP BY ec.name
     ORDER BY amount_crc DESC`,
    params
  );
  return res.rows.map((r) => ({
    category: r.category,
    amount_crc: round2(Number(r.amount_crc || 0)),
  }));
}

function buildDirectExpensesByFarm(rows) {
  const m = new Map();
  for (const r of rows) {
    const key = r.farm_id ? String(r.farm_id) : r.farm_name;
    if (!m.has(key)) {
      m.set(key, {
        farm_id: r.farm_id,
        farm_name: r.farm_name,
        amount_crc: 0,
      });
    }
    m.get(key).amount_crc += Number(r.amount_crc || 0);
  }
  return [...m.values()]
    .map((x) => ({ ...x, amount_crc: round2(x.amount_crc) }))
    .sort((a, b) => b.amount_crc - a.amount_crc);
}

function buildCostPerHaByLot(rentLots, areaMap) {
  return rentLots.map((r) => {
    const ha = areaMap.get(String(r.lot_id));
    const cost = Number(r.cost_crc || 0);
    const costPerHa = ha != null && ha > 0 && cost > 0 ? round2(cost / ha) : null;
    return {
      lot_id: r.lot_id,
      lot_name: r.lot_name,
      farm_name: r.farm_name,
      cost_crc: round2(cost),
      area_ha: ha != null && ha > 0 ? round2(ha) : null,
      cost_per_ha_crc: costPerHa,
    };
  });
}

function buildCostPerHaByFarm(rentLots, areaMap) {
  const byFarm = new Map();
  for (const r of rentLots) {
    const key = r.farm_id ? String(r.farm_id) : r.farm_name;
    const ha = areaMap.get(String(r.lot_id));
    const cost = Number(r.cost_crc || 0);
    if (!byFarm.has(key)) {
      byFarm.set(key, { farm_id: r.farm_id, farm_name: r.farm_name, cost_crc: 0, area_ha: 0 });
    }
    const agg = byFarm.get(key);
    agg.cost_crc += cost;
    if (ha != null && ha > 0) agg.area_ha += ha;
  }
  return [...byFarm.values()]
    .map((f) => ({
      farm_id: f.farm_id,
      farm_name: f.farm_name,
      cost_crc: round2(f.cost_crc),
      area_ha: f.area_ha > 0 ? round2(f.area_ha) : null,
      cost_per_ha_crc:
        f.area_ha > 0 && f.cost_crc > 0 ? round2(f.cost_crc / f.area_ha) : null,
    }))
    .sort((a, b) => (b.cost_per_ha_crc || 0) - (a.cost_per_ha_crc || 0));
}

async function getOverview(query) {
  const { from, to, farmId, lotId } = parseDateRange(query);
  const clientId = query.clientId;
  if (!clientId) {
    const err = new Error('No hay organización activa para estadísticas. Si eres superadmin, elige una organización.');
    err.status = 403;
    throw err;
  }

  const depAlloc = await getAssetDepreciationAllocByLot({ clientId, from, to, farmId, lotId });

  const [
    prod,
    costs,
    rentLots,
    rentFarms,
    invTop,
    invLow,
    laborTypes,
    laborCostOcc,
    laborRegCounts,
    expByCat,
    harvestWeek,
    harvestMonth,
    byCaliber,
    dirExpLots,
    invItemLot,
    labMonth,
    labWeek,
    labYear,
    lotAreasMap,
  ] = await Promise.all([
    getTotalProductionKgAndRevenue({ clientId, from, to, farmId, lotId }),
    getCostBreakdown({ clientId, from, to, farmId, lotId, assetDepreciationAlloc: depAlloc }),
    getRentabilityByLot({ clientId, from, to, farmId, lotId, assetDepreciationAlloc: depAlloc }),
    getRentabilityByFarm({ clientId, from, to, farmId, lotId, assetDepreciationAlloc: depAlloc }),
    getInventoryTopConsumed({ clientId, from, to, farmId, lotId, limit: 15 }),
    getInventoryLowStock({ clientId, threshold: Number(query.low_stock_threshold) || 10, limit: 25 }),
    loadLaborByTypeBundle({ clientId, from, to, farmId, lotId }),
    getLaborCostByTypeOccasionalOnly({ clientId, from, to, farmId, lotId }),
    getLaborTypeRegistrationCounts({ clientId, from, to, farmId, lotId }),
    getExpensesByCategory({ clientId, from, to, farmId, lotId }),
    getHarvestKgBuckets({ clientId, from, to, farmId, lotId, bucket: 'week' }),
    getHarvestKgBuckets({ clientId, from, to, farmId, lotId, bucket: 'month' }),
    getProductionKgByCaliber({ clientId, from, to, farmId, lotId }),
    getDirectExpensesByLot({ clientId, from, to, farmId, lotId }),
    getInventoryConsumedByItemLot({ clientId, from, to, farmId, lotId, limit: 40 }),
    getLaborSpendByBucketOccasional({ clientId, from, to, farmId, lotId, bucket: 'month' }),
    getLaborSpendByBucketOccasional({ clientId, from, to, farmId, lotId, bucket: 'week' }),
    getLaborSpendByBucketOccasional({ clientId, from, to, farmId, lotId, bucket: 'year' }),
    getLotAreasMap({ clientId, farmId, lotId }),
  ]);

  const costPerKg =
    prod.totalKg > 0 ? round2(costs.totalDirectCostsCrc / prod.totalKg) : null;
  const marginTotalCrc = round2(prod.totalRevenueCrc - costs.totalDirectCostsCrc);

  const yieldByLot = buildYieldByLot(rentLots, lotAreasMap);
  const yieldByFarm = buildYieldByFarm(rentLots, lotAreasMap);
  const directExpensesByFarm = buildDirectExpensesByFarm(dirExpLots);
  const costPerHaByLot = buildCostPerHaByLot(rentLots, lotAreasMap);
  const costPerHaByFarm = buildCostPerHaByFarm(rentLots, lotAreasMap);

  return {
    period: { from, to },
    filters: { farm_id: farmId, lot_id: lotId },
    cost_production: {
      total_kg: prod.totalKg,
      total_revenue_crc: prod.totalRevenueCrc,
      total_direct_costs_crc: costs.totalDirectCostsCrc,
      cost_per_kg_crc: costPerKg,
      margin_total_crc: marginTotalCrc,
      breakdown_crc: {
        expenses: costs.expensesCrc,
        labor: costs.laborTotalCrc,
        labor_lot: costs.laborLotCrc,
        labor_farm_allocated: costs.laborFarmAllocatedCrc,
        inventory_consumption: costs.inventoryConsumptionCrc,
        general_expense_allocations: costs.generalExpenseAllocCrc,
        payroll_slip_lot_allocations: costs.payrollSlipLotAllocCrc,
        fixed_payroll_allocations: costs.fixedPayrollAllocCrc,
        asset_depreciation: costs.assetDepreciationCrc,
      },
    },
    rentability_lots: rentLots,
    rentability_farms: rentFarms,
    inventory_top_consumed: invTop,
    inventory_low_stock: invLow,
    labor_by_type: laborTypes.labor_by_type,
    labor_by_type_presence_payroll: laborTypes.labor_by_type_presence_payroll,
    labor_cost_by_type_ocasional: laborCostOcc,
    labor_type_registrations: laborRegCounts,
    expenses_by_category: expByCat,
    harvest_weekly_kg: harvestWeek,
    harvest_monthly_kg: harvestMonth,
    production_kg_by_caliber: byCaliber,
    direct_expenses_by_lot: dirExpLots,
    direct_expenses_by_farm: directExpensesByFarm,
    inventory_consumed_by_item_lot: invItemLot,
    labor_spend_by_month: labMonth,
    labor_spend_by_week: labWeek,
    labor_spend_by_year: labYear,
    yield_by_lot: yieldByLot,
    yield_by_farm: yieldByFarm,
    cost_per_ha_by_lot: costPerHaByLot,
    cost_per_ha_by_farm: costPerHaByFarm,
    notes: [
      'El costo por kg usa la suma de kilos registrados en producción (detalle por calibre) en el periodo.',
      'Los ingresos se toman del valor declarado en producción (kilos × precio por kg).',
      'El costo de planilla variable proviene solo de planillas en estado pagada, repartido por lotes (payroll_slip_lot_allocations).',
      'La depreciación de activos fijos (activos y periodos de depreciación en estado activo) se incluye en costos directos: se escala al alcance del filtro por proporción de hectáreas de lote y se reparte entre lotes por área.',
      'La tabla “Labores por tipo” (resumen global) sigue mostrando jornadas netas más planilla variable y nómina fija a lotes atribuida por tipo; la vista de mano de obra usa además columnas dedicadas: costo por tipo solo ocasionales, registros por tipo (todos los trabajadores) y picos temporales solo ocasionales.',
      'En la pantalla de mano de obra: «Costo por tipo (ocasionales)» suma montos de registros de labor (monto distinto de cero) de trabajadores ocasionales, sin excluir días cubiertos por planilla pagada ni sumar planilla. «Tipos más realizados» cuenta registros de labor con todos los trabajadores. Picos semana/mes/año suman montos de jornadas solo de ocasionales.',
      'Rendimiento (kg/ha) y costo/ha usan el área en hectáreas registrada en cada lote; lotes sin área no aportan al cociente.',
    ],
  };
}

module.exports = {
  parseDateRange,
  getOverview,
};
