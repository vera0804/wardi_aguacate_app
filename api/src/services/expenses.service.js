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

function mapExpenseRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    lot_id: row.lot_id,
    category_id: row.category_id,
    exp_date: row.exp_date,
    category: row.category,
    description: row.description,
    currency: row.currency,
    fx_rate: row.fx_rate != null ? Number(row.fx_rate) : null,
    amount_input: row.amount_input != null ? Number(row.amount_input) : null,
    amount: row.amount != null ? Number(row.amount) : null,
    amount_crc: row.amount_crc != null ? Number(row.amount_crc) : null,
    amount_usd: row.amount_usd != null ? Number(row.amount_usd) : null,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
    lot_name: row.lot_name,
    farm_id: row.farm_id,
    farm_name: row.farm_name,
  };
}

const expenseJoinSql = `
  FROM expenses e
  INNER JOIN expense_categories ec ON ec.id = e.category_id AND ec.client_id = e.client_id
  INNER JOIN lots l ON l.id = e.lot_id AND l.client_id = e.client_id
  LEFT JOIN farms f ON f.id = l.farm_id AND f.client_id = e.client_id
`;

async function getMeta({ clientId }) {
  const [lotsRes, catsRes] = await Promise.all([
    pool.query(
      `SELECT l.id, l.name, l.farm_id, f.name AS farm_name
       FROM lots l
       INNER JOIN farms f ON f.id = l.farm_id AND f.client_id = l.client_id
       WHERE l.client_id = $1 AND l.is_active = true
       ORDER BY f.name ASC, l.name ASC`,
      [clientId]
    ),
    pool.query(
      `SELECT id, name, status, created_at, updated_at
       FROM expense_categories
       WHERE client_id = $1 AND status = 'activo'
       ORDER BY name_norm ASC`,
      [clientId]
    ),
  ]);
  const expense_categories = (catsRes.rows || []).map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    is_active: r.status === 'activo',
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
  return { lots: lotsRes.rows, expense_categories };
}

async function listExpenses({
  clientId,
  lotId,
  category,
  active,
  fromDate,
  toDate,
  limit,
  offset,
}) {
  const values = [clientId];
  let where = 'WHERE e.client_id = $1';

  if (lotId) {
    values.push(lotId);
    where += ` AND e.lot_id = $${values.length}`;
  }
  if (category) {
    values.push(`%${String(category).trim()}%`);
    where += ` AND ec.name ILIKE $${values.length}`;
  }
  if (active === true) where += ' AND e.is_active = true';
  else if (active === false) where += ' AND e.is_active = false';

  if (fromDate) {
    values.push(String(fromDate).trim());
    where += ` AND e.exp_date >= $${values.length}::date`;
  }
  if (toDate) {
    values.push(String(toDate).trim());
    where += ` AND e.exp_date <= $${values.length}::date`;
  }

  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const limPos = values.length + 1;
  const offPos = values.length + 2;
  values.push(lim, off);

  const countSql = `SELECT COUNT(*)::int AS c ${expenseJoinSql} ${where}`;
  const countRes = await pool.query(countSql, values.slice(0, values.length - 2));
  const total = countRes.rows[0]?.c ?? 0;

  const dataSql = `
    SELECT e.*,
           ec.name AS category,
           l.name AS lot_name,
           l.farm_id,
           f.name AS farm_name
    ${expenseJoinSql}
    ${where}
    ORDER BY e.exp_date DESC, e.created_at DESC
    LIMIT $${limPos} OFFSET $${offPos}
  `;
  const dataRes = await pool.query(dataSql, values);
  return { rows: dataRes.rows.map(mapExpenseRow), total, limit: lim, offset: off };
}

async function getExpenseById({ id, clientId }) {
  const res = await pool.query(
    `SELECT e.*,
            ec.name AS category,
            l.name AS lot_name,
            l.farm_id,
            f.name AS farm_name
     FROM expenses e
     INNER JOIN expense_categories ec ON ec.id = e.category_id AND ec.client_id = e.client_id
     INNER JOIN lots l ON l.id = e.lot_id AND l.client_id = e.client_id
     LEFT JOIN farms f ON f.id = l.farm_id AND f.client_id = e.client_id
     WHERE e.id = $1 AND e.client_id = $2`,
    [id, clientId]
  );
  return mapExpenseRow(res.rows[0]);
}

async function assertLotForClient({ lotId, clientId }) {
  const r = await pool.query(`SELECT id FROM lots WHERE id = $1 AND client_id = $2 AND is_active = true`, [
    lotId,
    clientId,
  ]);
  if (!r.rows[0]) {
    const err = new Error('Lote no encontrado o inactivo.');
    err.status = 409;
    throw err;
  }
}

async function createExpense({ clientId, userId, body }) {
  const lotId = String(body?.lot_id || '').trim();
  const expDate = String(body?.exp_date || '').trim();
  const categoryId = String(body?.category_id || '').trim();
  if (!lotId || !expDate || !categoryId) {
    const err = new Error('lot_id, exp_date y category_id son obligatorios.');
    err.status = 400;
    throw err;
  }
  await assertLotForClient({ lotId, clientId });
  await assertExpenseCategoryForClient({ categoryId, clientId, requireActive: true });
  const money = resolveMoneyFields(body);
  const desc = body?.description != null ? String(body.description).trim() : null;

  const res = await pool.query(
    `INSERT INTO expenses (
       lot_id, harvest_id, exp_date, category_id, description,
       amount, currency, fx_rate, amount_input, amount_crc, amount_usd,
       is_active, client_id, created_by_user_id, updated_by_user_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,$12,$13,$13)
     RETURNING id`,
    [
      lotId,
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
      clientId,
      userId,
    ]
  );
  return getExpenseById({ id: res.rows[0].id, clientId });
}

async function updateExpense({ id, clientId, userId, body }) {
  const cur = await pool.query(`SELECT * FROM expenses WHERE id = $1 AND client_id = $2`, [id, clientId]);
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

  if (body?.lot_id !== undefined) {
    const lotId = String(body.lot_id || '').trim();
    if (!lotId) {
      const err = new Error('lot_id no puede quedar vacío.');
      err.status = 400;
      throw err;
    }
    await assertLotForClient({ lotId, clientId });
    add('lot_id', lotId);
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

  if (!fields.length) return getExpenseById({ id, clientId });

  add('updated_by_user_id', userId);
  values.push(id, clientId);
  const sql = `UPDATE expenses SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${i} AND client_id = $${i + 1} RETURNING id`;
  const res = await pool.query(sql, values);
  if (!res.rows[0]) return null;
  return getExpenseById({ id, clientId });
}

async function setExpenseActive({ id, clientId, userId, isActive }) {
  const res = await pool.query(
    `UPDATE expenses
     SET is_active = $3, updated_by_user_id = $4, updated_at = NOW()
     WHERE id = $1 AND client_id = $2
     RETURNING id`,
    [id, clientId, Boolean(isActive), userId]
  );
  if (!res.rows[0]) return null;
  return getExpenseById({ id, clientId });
}

module.exports = {
  parseActiveQuery,
  getMeta,
  listExpenses,
  getExpenseById,
  createExpense,
  updateExpense,
  setExpenseActive,
};
