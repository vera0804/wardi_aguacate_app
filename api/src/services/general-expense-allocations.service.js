const { pool } = require('../db');

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function mapAllocationRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    general_expense_id: row.general_expense_id,
    lot_id: row.lot_id,
    allocation_basis: row.allocation_basis,
    allocation_pct: row.allocation_pct != null ? Number(row.allocation_pct) : null,
    amount_allocated: row.amount_allocated != null ? Number(row.amount_allocated) : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    is_active: row.is_active,
    expense_category: row.expense_category,
    expense_exp_date: row.expense_exp_date,
    expense_amount_crc: row.expense_amount_crc != null ? Number(row.expense_amount_crc) : null,
    expense_allocation_method: row.expense_allocation_method,
    lot_name: row.lot_name,
    farm_id: row.farm_id,
    farm_name: row.farm_name,
  };
}

async function listAllocations({ clientId, generalExpenseId, lotId }) {
  if (!generalExpenseId && !lotId) {
    const err = new Error('general_expense_id o lot_id es obligatorio.');
    err.status = 400;
    throw err;
  }
  const values = [clientId];
  let where = 'WHERE ge.client_id = $1';
  if (generalExpenseId) {
    values.push(generalExpenseId);
    where += ` AND a.general_expense_id = $${values.length}`;
  }
  if (lotId) {
    values.push(lotId);
    where += ` AND a.lot_id = $${values.length}`;
  }
  const res = await pool.query(
    `SELECT a.*,
            ec.name AS expense_category,
            ge.exp_date AS expense_exp_date,
            ge.amount_crc AS expense_amount_crc,
            ge.allocation_method AS expense_allocation_method,
            l.name AS lot_name,
            l.farm_id,
            f.name AS farm_name
     FROM general_expense_allocations a
     INNER JOIN general_expenses ge ON ge.id = a.general_expense_id
     INNER JOIN expense_categories ec ON ec.id = ge.category_id AND ec.client_id = ge.client_id
     INNER JOIN lots l ON l.id = a.lot_id AND l.client_id = ge.client_id
     LEFT JOIN farms f ON f.id = l.farm_id AND f.client_id = ge.client_id
     ${where}
     ORDER BY f.name ASC NULLS LAST, l.name ASC`,
    values
  );
  return res.rows.map(mapAllocationRow);
}

async function patchAllocation({ id, clientId, body }) {
  const hasPct = Object.prototype.hasOwnProperty.call(body || {}, 'allocation_pct');
  const hasAmt = Object.prototype.hasOwnProperty.call(body || {}, 'amount_allocated');
  if (hasPct === hasAmt) {
    const err = new Error('Debe enviarse allocation_pct o amount_allocated (solo uno).');
    err.status = 400;
    throw err;
  }

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const r = await db.query(
      `SELECT a.id, a.general_expense_id, a.lot_id, a.allocation_pct, a.amount_allocated,
              ge.amount_crc, ge.allocation_method
       FROM general_expense_allocations a
       INNER JOIN general_expenses ge ON ge.id = a.general_expense_id
       WHERE a.id = $1 AND ge.client_id = $2`,
      [id, clientId]
    );
    const row = r.rows[0];
    if (!row) {
      await db.query('ROLLBACK');
      return null;
    }
    if (row.allocation_method !== 'manual') {
      const err = new Error('Solo se pueden editar asignaciones de gastos con reparto manual.');
      err.status = 400;
      throw err;
    }
    const totalCrc = Number(row.amount_crc);
    let pct;
    let amt;
    if (hasPct) {
      pct = Number(body.allocation_pct);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        const err = new Error('allocation_pct inválido.');
        err.status = 400;
        throw err;
      }
      amt = round2((totalCrc * pct) / 100);
    } else {
      amt = round2(Number(body.amount_allocated));
      if (!Number.isFinite(amt) || amt < 0) {
        const err = new Error('amount_allocated inválido.');
        err.status = 400;
        throw err;
      }
      pct = totalCrc > 0 ? round2((100 * amt) / totalCrc) : 0;
    }

    await db.query(
      `UPDATE general_expense_allocations
       SET allocation_pct = $1, amount_allocated = $2, allocation_basis = 'manual', updated_at = NOW()
       WHERE id = $3`,
      [pct, amt, id]
    );
    await db.query('COMMIT');
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }

  const out = await pool.query(
    `SELECT a.*,
            ec.name AS expense_category,
            ge.exp_date AS expense_exp_date,
            ge.amount_crc AS expense_amount_crc,
            ge.allocation_method AS expense_allocation_method,
            l.name AS lot_name,
            l.farm_id,
            f.name AS farm_name
     FROM general_expense_allocations a
     INNER JOIN general_expenses ge ON ge.id = a.general_expense_id
     INNER JOIN expense_categories ec ON ec.id = ge.category_id AND ec.client_id = ge.client_id
     INNER JOIN lots l ON l.id = a.lot_id AND l.client_id = ge.client_id
     LEFT JOIN farms f ON f.id = l.farm_id AND f.client_id = ge.client_id
     WHERE a.id = $1 AND ge.client_id = $2`,
    [id, clientId]
  );
  return mapAllocationRow(out.rows[0]);
}

async function commitAllocations({ clientId, body }) {
  const geId = String(body?.general_expense_id || '').trim();
  const rows = body?.rows;
  if (!geId || !Array.isArray(rows) || rows.length === 0) {
    const err = new Error('general_expense_id y rows (no vacío) son obligatorios.');
    err.status = 400;
    throw err;
  }

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const geRes = await db.query(
      `SELECT id, amount_crc, allocation_method FROM general_expenses WHERE id = $1 AND client_id = $2`,
      [geId, clientId]
    );
    const ge = geRes.rows[0];
    if (!ge) {
      const err = new Error('Gasto general no encontrado.');
      err.status = 404;
      throw err;
    }
    if (ge.allocation_method !== 'manual') {
      const err = new Error('Solo aplica commit para gastos con reparto manual.');
      err.status = 400;
      throw err;
    }
    const target = Number(ge.amount_crc);
    let sum = 0;

    for (const item of rows) {
      const hasPct = Object.prototype.hasOwnProperty.call(item, 'allocation_pct');
      const hasAmt = Object.prototype.hasOwnProperty.call(item, 'amount_allocated');
      if (hasPct === hasAmt) {
        const err = new Error('Cada fila debe tener allocation_pct o amount_allocated (solo uno).');
        err.status = 400;
        throw err;
      }
      const aRes = await db.query(
        `SELECT a.id, ge.amount_crc
         FROM general_expense_allocations a
         INNER JOIN general_expenses ge ON ge.id = a.general_expense_id
         WHERE a.id = $1 AND a.general_expense_id = $2 AND ge.client_id = $3`,
        [item.id, geId, clientId]
      );
      if (!aRes.rows[0]) {
        const err = new Error('Asignación no pertenece al gasto o no existe.');
        err.status = 400;
        throw err;
      }
      const totalCrc = Number(aRes.rows[0].amount_crc);
      let pct;
      let amt;
      if (hasPct) {
        pct = Number(item.allocation_pct);
        amt = round2((totalCrc * pct) / 100);
      } else {
        amt = round2(Number(item.amount_allocated));
        pct = totalCrc > 0 ? round2((100 * amt) / totalCrc) : 0;
      }
      sum += amt;
      await db.query(
        `UPDATE general_expense_allocations
         SET allocation_pct = $1, amount_allocated = $2, allocation_basis = 'manual', updated_at = NOW()
         WHERE id = $3`,
        [pct, amt, item.id]
      );
    }

    if (Math.abs(sum - target) > 0.05) {
      const err = new Error(
        `La suma de montos asignados (${round2(sum)}) no coincide con el total del gasto (${target} CRC). Tolerancia 0.05 CRC.`
      );
      err.status = 400;
      throw err;
    }

    await db.query('COMMIT');
    return listAllocations({ clientId, generalExpenseId: geId });
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}

module.exports = {
  listAllocations,
  patchAllocation,
  commitAllocations,
};
