const { pool } = require('../db');

function parseActiveQuery(raw) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const v = String(raw).trim().toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  const err = new Error('El parámetro active debe ser true o false.');
  err.status = 400;
  throw err;
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function linearDepreciationAmounts(purchaseCost, salvage, usefulLifeYears) {
  const n = usefulLifeYears * 12;
  const base = round2(Number(purchaseCost) - Number(salvage));
  if (n <= 0) {
    const err = new Error('La vida útil en años debe ser mayor que 0.');
    err.status = 400;
    throw err;
  }
  if (base <= 0) return Array.from({ length: n }, () => 0);
  const raw = base / n;
  const amounts = [];
  let sum = 0;
  for (let i = 0; i < n - 1; i += 1) {
    const a = round2(raw);
    amounts.push(a);
    sum += a;
  }
  amounts.push(round2(base - sum));
  return amounts;
}

function addCalendarMonths(year, month, delta) {
  const d = new Date(year, month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function mapDepRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    asset_id: row.asset_id,
    period_year: row.period_year,
    period_month: row.period_month,
    depreciation_amount: row.depreciation_amount != null ? Number(row.depreciation_amount) : null,
    accumulated_depreciation:
      row.accumulated_depreciation != null ? Number(row.accumulated_depreciation) : null,
    book_value: row.book_value != null ? Number(row.book_value) : null,
    status: row.status,
    is_active: row.status === 'activo',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function listAssetDepreciation({ clientId, assetId, active }) {
  if (!assetId) {
    const err = new Error('asset_id es obligatorio.');
    err.status = 400;
    throw err;
  }
  const ok = await pool.query(`SELECT 1 FROM assets WHERE id = $1 AND client_id = $2`, [assetId, clientId]);
  if (!ok.rows[0]) {
    const err = new Error('Activo no encontrado.');
    err.status = 404;
    throw err;
  }
  const values = [assetId, clientId];
  let sql = `SELECT id, asset_id, period_year, period_month, depreciation_amount,
                    accumulated_depreciation, book_value, status, created_at, updated_at
             FROM asset_depreciation WHERE asset_id = $1 AND client_id = $2`;
  if (active === true) sql += ` AND status = 'activo'`;
  else if (active === false) sql += ` AND status = 'inactivo'`;
  sql += ` ORDER BY period_year ASC, period_month ASC`;
  const res = await pool.query(sql, values);
  return res.rows.map(mapDepRow);
}

async function calculateAssetDepreciation({ clientId, userId, assetId }) {
  if (!assetId) {
    const err = new Error('asset_id es obligatorio.');
    err.status = 400;
    throw err;
  }

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const aRes = await db.query(
      `SELECT id, purchase_date, purchase_cost, useful_life_years, salvage_value, status, client_id
       FROM assets WHERE id = $1 AND client_id = $2`,
      [assetId, clientId]
    );
    const a = aRes.rows[0];
    if (!a) {
      const err = new Error('Activo no encontrado.');
      err.status = 404;
      throw err;
    }
    if (a.status !== 'activo') {
      const err = new Error('Solo se puede calcular depreciación para activos en estado activo.');
      err.status = 400;
      throw err;
    }

    const purchaseCost = Number(a.purchase_cost);
    const salvage = Number(a.salvage_value);
    const years = Number(a.useful_life_years);
    const amounts = linearDepreciationAmounts(purchaseCost, salvage, years);

    const pd = a.purchase_date;
    let y;
    let m;
    if (pd instanceof Date) {
      y = pd.getFullYear();
      m = pd.getMonth() + 1;
    } else if (typeof pd === 'string' && /^\d{4}-\d{2}-\d{2}/.test(pd)) {
      y = Number(pd.slice(0, 4));
      m = Number(pd.slice(5, 7));
    } else {
      const d = new Date(pd);
      y = d.getFullYear();
      m = d.getMonth() + 1;
    }

    let accumulated = 0;
    for (let i = 0; i < amounts.length; i += 1) {
      const amt = amounts[i];
      accumulated = round2(accumulated + amt);
      const book = round2(purchaseCost - accumulated);
      const period = addCalendarMonths(y, m, i);

      await db.query(
        `INSERT INTO asset_depreciation (
           asset_id, period_year, period_month, depreciation_amount, accumulated_depreciation, book_value,
           status, client_id, created_by, updated_by, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,'activo',$7,$8,$8,NOW())
         ON CONFLICT (asset_id, period_year, period_month) DO UPDATE SET
           depreciation_amount = EXCLUDED.depreciation_amount,
           accumulated_depreciation = EXCLUDED.accumulated_depreciation,
           book_value = EXCLUDED.book_value,
           status = 'activo',
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
        [assetId, period.year, period.month, amt, accumulated, book, clientId, userId]
      );
    }

    await db.query('COMMIT');
    return listAssetDepreciation({ clientId, assetId, active: undefined });
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}

module.exports = {
  parseActiveQuery,
  listAssetDepreciation,
  calculateAssetDepreciation,
};
