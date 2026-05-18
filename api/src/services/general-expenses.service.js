const { pool } = require('../db');
const { assertExpenseCategoryForClient } = require('./expense-categories.service');

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function parseActiveQuery(raw) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const v = String(raw).trim().toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  const err = new Error('El parámetro active debe ser true o false.');
  err.status = 400;
  throw err;
}

function resolveMoneyFields(body) {
  const currency = String(body?.currency ?? 'CRC')
    .trim()
    .toUpperCase();
  if (currency !== 'CRC' && currency !== 'USD') {
    const err = new Error("currency debe ser 'CRC' o 'USD'.");
    err.status = 400;
    throw err;
  }
  const amountInput = Number(body.amount_input);
  if (!Number.isFinite(amountInput) || amountInput < 0) {
    const err = new Error('amount_input inválido.');
    err.status = 400;
    throw err;
  }
  let fxRate = null;
  let amountUsd = null;
  let amountCrc;
  let amount;
  if (currency === 'CRC') {
    amountCrc = round2(amountInput);
    amount = amountCrc;
  } else {
    const fx = Number(body.fx_rate);
    if (!Number.isFinite(fx) || fx <= 0) {
      const err = new Error('En moneda USD, fx_rate es obligatorio y debe ser mayor que 0.');
      err.status = 400;
      throw err;
    }
    fxRate = fx;
    amountUsd = round2(amountInput);
    amountCrc = round2(amountInput * fx);
    amount = amountCrc;
  }
  return {
    currency,
    fx_rate: fxRate,
    amount_input: round2(amountInput),
    amount_crc: amountCrc,
    amount_usd: amountUsd,
    amount,
  };
}

function mapGeneralExpenseRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    farm_id: row.farm_id,
    category_id: row.category_id,
    exp_date: row.exp_date,
    category: row.category,
    description: row.description,
    allocation_method: row.allocation_method,
    currency: row.currency,
    fx_rate: row.fx_rate != null ? Number(row.fx_rate) : null,
    amount_input: row.amount_input != null ? Number(row.amount_input) : null,
    amount: row.amount != null ? Number(row.amount) : null,
    amount_crc: row.amount_crc != null ? Number(row.amount_crc) : null,
    amount_usd: row.amount_usd != null ? Number(row.amount_usd) : null,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
    farm_name: row.farm_name,
  };
}

const geJoinSql = `
  FROM general_expenses ge
  INNER JOIN expense_categories ec ON ec.id = ge.category_id AND ec.client_id = ge.client_id
  LEFT JOIN farms f ON f.id = ge.farm_id AND f.client_id = ge.client_id
`;

async function assertFarmOptional({ farmId, clientId }) {
  if (!farmId) return;
  const r = await pool.query(`SELECT id FROM farms WHERE id = $1 AND client_id = $2 AND is_active = true`, [
    farmId,
    clientId,
  ]);
  if (!r.rows[0]) {
    const err = new Error('Finca no encontrada o inactiva.');
    err.status = 409;
    throw err;
  }
}

/** Igual que en labores/inventario: `labor_allocation_mode` de la finca; sin finca → por área. */
async function resolveGeneralExpenseAllocationMethod({ farmId, clientId }) {
  if (!farmId) return 'area_ha';
  const r = await pool.query(
    `SELECT labor_allocation_mode FROM farms WHERE id = $1 AND client_id = $2 AND is_active = true`,
    [farmId, clientId]
  );
  const mode = String(r.rows[0]?.labor_allocation_mode || 'area').toLowerCase();
  return mode === 'manual' ? 'manual' : 'area_ha';
}

async function listGeneralExpenses({
  clientId,
  farmId,
  category,
  active,
  fromDate,
  toDate,
  limit,
  offset,
}) {
  const values = [clientId];
  let where = 'WHERE ge.client_id = $1';

  if (farmId) {
    values.push(farmId);
    where += ` AND ge.farm_id = $${values.length}`;
  }
  if (category) {
    values.push(`%${String(category).trim()}%`);
    where += ` AND ec.name ILIKE $${values.length}`;
  }
  if (active === true) where += ' AND ge.is_active = true';
  else if (active === false) where += ' AND ge.is_active = false';

  if (fromDate) {
    values.push(String(fromDate).trim());
    where += ` AND ge.exp_date >= $${values.length}::date`;
  }
  if (toDate) {
    values.push(String(toDate).trim());
    where += ` AND ge.exp_date <= $${values.length}::date`;
  }

  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const offPos = values.length + 1;
  const limPos = values.length + 2;
  values.push(off, lim);

  const countSql = `SELECT COUNT(*)::int AS c ${geJoinSql} ${where}`;
  const countRes = await pool.query(countSql, values.slice(0, values.length - 2));
  const total = countRes.rows[0]?.c ?? 0;

  const dataSql = `
    SELECT ge.*,
           ec.name AS category,
           f.name AS farm_name
    ${geJoinSql}
    ${where}
    ORDER BY ge.exp_date DESC, ge.created_at DESC
    OFFSET $${offPos} LIMIT $${limPos}
  `;
  const dataRes = await pool.query(dataSql, values);
  return { rows: dataRes.rows.map(mapGeneralExpenseRow), total, limit: lim, offset: off };
}

async function getGeneralExpenseById({ id, clientId }) {
  const res = await pool.query(
    `SELECT ge.*,
            ec.name AS category,
            f.name AS farm_name
     FROM general_expenses ge
     INNER JOIN expense_categories ec ON ec.id = ge.category_id AND ec.client_id = ge.client_id
     LEFT JOIN farms f ON f.id = ge.farm_id AND f.client_id = ge.client_id
     WHERE ge.id = $1 AND ge.client_id = $2`,
    [id, clientId]
  );
  return mapGeneralExpenseRow(res.rows[0]);
}

async function createGeneralExpense({ clientId, userId, body }) {
  const expDate = String(body?.exp_date || '').trim();
  const categoryId = String(body?.category_id || '').trim();
  if (!expDate || !categoryId) {
    const err = new Error('exp_date y category_id son obligatorios.');
    err.status = 400;
    throw err;
  }
  await assertExpenseCategoryForClient({ categoryId, clientId, requireActive: true });
  const farmId = body?.farm_id ? String(body.farm_id).trim() : null;
  await assertFarmOptional({ farmId, clientId });
  const method = await resolveGeneralExpenseAllocationMethod({ farmId, clientId });
  const money = resolveMoneyFields(body);
  const desc = body?.description != null ? String(body.description).trim() : null;

  const res = await pool.query(
    `INSERT INTO general_expenses (
       farm_id, harvest_id, exp_date, category_id, description,
       amount, currency, fx_rate, amount_input, amount_crc, amount_usd,
       allocation_method, is_active, client_id, created_by_user_id, updated_by_user_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,$13,$14,$14)
     RETURNING id`,
    [
      farmId,
      null,
      expDate,
      categoryId,
      desc || null,
      money.amount,
      money.currency,
      money.fx_rate,
      money.amount_input,
      money.amount_crc,
      money.amount_usd,
      method,
      clientId,
      userId,
    ]
  );
  return getGeneralExpenseById({ id: res.rows[0].id, clientId });
}

async function updateGeneralExpense({ id, clientId, userId, body }) {
  const cur = await pool.query(`SELECT * FROM general_expenses WHERE id = $1 AND client_id = $2`, [id, clientId]);
  const row = cur.rows[0];
  if (!row) return null;

  const fields = [];
  const values = [];
  let i = 1;
  function add(field, val) {
    fields.push(`${field} = $${i}`);
    values.push(val);
    i += 1;
  }

  if (body?.farm_id !== undefined) {
    const farmId = body.farm_id ? String(body.farm_id).trim() : null;
    await assertFarmOptional({ farmId, clientId });
    add('farm_id', farmId);
  }
  if (body?.exp_date !== undefined) add('exp_date', String(body.exp_date).trim());
  if (body?.category_id !== undefined) {
    const cid = String(body.category_id || '').trim();
    if (!cid) {
      const err = new Error('category_id no puede quedar vacío.');
      err.status = 400;
      throw err;
    }
    await assertExpenseCategoryForClient({ categoryId: cid, clientId, requireActive: true });
    add('category_id', cid);
  }
  if (body?.description !== undefined) add('description', body.description != null ? String(body.description).trim() : null);
  if (body?.allocation_method !== undefined) {
    const m = String(body.allocation_method || '').trim().toLowerCase();
    if (m !== 'area_ha' && m !== 'manual') {
      const err = new Error("allocation_method debe ser 'area_ha' o 'manual'.");
      err.status = 400;
      throw err;
    }
    add('allocation_method', m);
  }

  const hasMoney = ['currency', 'amount_input', 'fx_rate'].some((k) =>
    Object.prototype.hasOwnProperty.call(body || {}, k)
  );
  if (hasMoney) {
    const merged = {
      currency: body.currency !== undefined ? body.currency : row.currency,
      amount_input: body.amount_input !== undefined ? body.amount_input : row.amount_input,
      fx_rate: body.fx_rate !== undefined ? body.fx_rate : row.fx_rate,
    };
    const money = resolveMoneyFields(merged);
    add('amount', money.amount);
    add('currency', money.currency);
    add('fx_rate', money.fx_rate);
    add('amount_input', money.amount_input);
    add('amount_crc', money.amount_crc);
    add('amount_usd', money.amount_usd);
  }

  if (!fields.length) return getGeneralExpenseById({ id, clientId });

  add('updated_by_user_id', userId);
  values.push(id, clientId);
  const sql = `UPDATE general_expenses SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${i} AND client_id = $${i + 1} RETURNING id`;
  await pool.query(sql, values);
  return getGeneralExpenseById({ id, clientId });
}

async function setGeneralExpenseActive({ id, clientId, userId, isActive }) {
  const res = await pool.query(
    `UPDATE general_expenses
     SET is_active = $3, updated_by_user_id = $4, updated_at = NOW()
     WHERE id = $1 AND client_id = $2
     RETURNING id`,
    [id, clientId, Boolean(isActive), userId]
  );
  if (!res.rows[0]) return null;
  return getGeneralExpenseById({ id, clientId });
}

async function seedAllocations({ id, clientId }) {
  const geRes = await pool.query(
    `SELECT id, farm_id, allocation_method, is_active, client_id
     FROM general_expenses WHERE id = $1 AND client_id = $2`,
    [id, clientId]
  );
  const ge = geRes.rows[0];
  if (!ge) {
    const err = new Error('Gasto general no encontrado.');
    err.status = 404;
    throw err;
  }
  if (ge.allocation_method !== 'manual') {
    const err = new Error('Solo se pueden generar líneas en borrador para reparto manual.');
    err.status = 400;
    throw err;
  }
  if (!ge.is_active) {
    const err = new Error('El gasto general está inactivo.');
    err.status = 400;
    throw err;
  }

  const farmId = ge.farm_id;
  let sql;
  let params;
  if (farmId) {
    sql = `
      INSERT INTO general_expense_allocations (
        general_expense_id, lot_id, allocation_basis, allocation_pct, amount_allocated, created_at, updated_at
      )
      SELECT $1, l.id, 'manual', NULL, 0, NOW(), NOW()
      FROM lots l
      WHERE l.client_id = $2
        AND l.farm_id = $3
        AND l.is_active = true
        AND NOT EXISTS (
          SELECT 1 FROM general_expense_allocations x
          WHERE x.general_expense_id = $1 AND x.lot_id = l.id
        )`;
    params = [id, clientId, farmId];
  } else {
    sql = `
      INSERT INTO general_expense_allocations (
        general_expense_id, lot_id, allocation_basis, allocation_pct, amount_allocated, created_at, updated_at
      )
      SELECT $1, l.id, 'manual', NULL, 0, NOW(), NOW()
      FROM lots l
      WHERE l.client_id = $2
        AND l.is_active = true
        AND NOT EXISTS (
          SELECT 1 FROM general_expense_allocations x
          WHERE x.general_expense_id = $1 AND x.lot_id = l.id
        )`;
    params = [id, clientId];
  }
  const ins = await pool.query(sql, params);
  return { inserted: ins.rowCount || 0 };
}

module.exports = {
  parseActiveQuery,
  listGeneralExpenses,
  getGeneralExpenseById,
  createGeneralExpense,
  updateGeneralExpense,
  setGeneralExpenseActive,
  seedAllocations,
};
