const { randomUUID } = require('crypto');
const { pool } = require('../db');
const allocationsService = require('./labor-entry-allocations.service');

function normalizeText(value) {
  if (value == null) return null;
  const v = String(value).trim();
  return v || null;
}

function normalizeDate(value, { required = false, field = 'cons_date' } = {}) {
  if (value === undefined && !required) return undefined;
  const v = String(value || '').trim();
  if (!v) {
    const err = new Error(`${field} es obligatorio.`);
    err.status = 400;
    throw err;
  }
  return v.slice(0, 10);
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function round3(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
}

function normalizePositiveQty(value, field = 'qty') {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    const err = new Error(`${field} debe ser mayor que 0.`);
    err.status = 400;
    throw err;
  }
  return round3(n);
}

function normalizeScope(value, { required = false } = {}) {
  if (value === undefined && !required) return undefined;
  const v = String(value || '').trim().toLowerCase();
  if (!['lot', 'farm'].includes(v)) {
    const err = new Error("cost_scope debe ser 'lot' o 'farm'.");
    err.status = 400;
    throw err;
  }
  return v;
}

function assertScopeReferences({ scope, lotId, farmId }) {
  if (scope === 'lot') {
    if (!lotId || farmId) {
      const err = new Error("En alcance 'lot', lot_id es obligatorio y farm_id debe ser null.");
      err.status = 400;
      throw err;
    }
  } else if (scope === 'farm') {
    if (!farmId || lotId) {
      const err = new Error("En alcance 'farm', farm_id es obligatorio y lot_id debe ser null.");
      err.status = 400;
      throw err;
    }
  }
}

async function assertLotBelongsToClient(db, lotId, clientId) {
  const r = await db.query(
    `SELECT id, name, farm_id FROM lots WHERE id = $1 AND client_id = $2 AND is_active = true`,
    [lotId, clientId]
  );
  if (!r.rows[0]) {
    const err = new Error('Lote no encontrado o inactivo.');
    err.status = 404;
    throw err;
  }
  return r.rows[0];
}

async function getFarmForClient(db, farmId, clientId) {
  const r = await db.query(
    `SELECT id, name, labor_allocation_mode, is_active
     FROM farms
     WHERE id = $1 AND client_id = $2 AND is_active = true`,
    [farmId, clientId]
  );
  if (!r.rows[0]) {
    const err = new Error('Finca no encontrada o inactiva.');
    err.status = 404;
    throw err;
  }
  return r.rows[0];
}

async function resolveHarvestDateRangeForList({ clientId, harvestId, fromDate, toDate }) {
  if (!harvestId) {
    return { fromDate: fromDate || null, toDate: toDate || null };
  }
  const h = await pool.query(
    `SELECT start_date, end_date FROM harvests WHERE id = $1 AND client_id = $2 AND is_active = true`,
    [harvestId, clientId]
  );
  if (!h.rows[0]) {
    const err = new Error('Cosecha no encontrada.');
    err.status = 404;
    throw err;
  }
  const row = h.rows[0];
  const sd =
    row.start_date instanceof Date ? row.start_date.toISOString().slice(0, 10) : String(row.start_date).slice(0, 10);
  const ed =
    row.end_date instanceof Date ? row.end_date.toISOString().slice(0, 10) : String(row.end_date).slice(0, 10);
  return { fromDate: sd, toDate: ed };
}

function parseActiveFilter(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const v = String(value).trim().toLowerCase();
  if (v === 'all') return undefined;
  if (['1', 'true', 'si', 'yes'].includes(v)) return true;
  if (['0', 'false', 'no'].includes(v)) return false;
  const err = new Error('El filtro active debe ser true, false o all.');
  err.status = 400;
  throw err;
}

/** Reparte cantidad total según porcentajes (último lote absorbe diferencias de redondeo). */
function splitQtyByAllocations(totalQty, allocations) {
  const total = Number(totalQty);
  let accumulated = 0;
  const out = [];
  for (let i = 0; i < allocations.length; i += 1) {
    const a = allocations[i];
    let q = round3((total * Number(a.allocation_pct)) / 100);
    if (i === allocations.length - 1) {
      q = round3(total - accumulated);
    }
    accumulated = round3(accumulated + q);
    out.push({ lot_id: a.lot_id, qty: q });
  }
  return out;
}

async function listInventoryConsumptions({
  clientId,
  active,
  lotId,
  farmId,
  itemId,
  expenseId,
  harvestId,
  fromDate,
  toDate,
}) {
  let activeInput = active;
  if (activeInput === undefined || activeInput === null || activeInput === '') {
    activeInput = 'true';
  }
  const activeFilter = parseActiveFilter(activeInput);
  const range = await resolveHarvestDateRangeForList({ clientId, harvestId, fromDate, toDate });

  const clauses = ['l.client_id = $1', 'ii.client_id = $1'];
  const values = [clientId];
  let idx = 2;

  if (activeFilter !== undefined) {
    clauses.push(`ic.is_active = $${idx++}`);
    values.push(activeFilter);
  }
  if (lotId) {
    clauses.push(`ic.lot_id = $${idx++}`);
    values.push(lotId);
  }
  if (farmId) {
    clauses.push(`ic.farm_id = $${idx++}`);
    values.push(farmId);
  }
  if (itemId) {
    clauses.push(`ic.item_id = $${idx++}`);
    values.push(itemId);
  }
  if (expenseId) {
    clauses.push(`ic.expense_id = $${idx++}`);
    values.push(expenseId);
  }
  if (range.fromDate) {
    clauses.push(`ic.cons_date >= $${idx++}`);
    values.push(range.fromDate);
  }
  if (range.toDate) {
    clauses.push(`ic.cons_date <= $${idx++}`);
    values.push(range.toDate);
  }

  const res = await pool.query(
    `SELECT ic.id, ic.lot_id, ic.farm_id, ic.cost_scope, ic.application_group_id,
            ic.item_id, ic.cons_date, ic.qty,
            ic.unit_cost_applied, ic.amount, ic.notes, ic.is_active, ic.mix_application_id,
            ic.created_at, ic.updated_at,
            l.name AS lot_name,
            f.name AS farm_name,
            ii.name AS item_name, ii.unit AS item_unit
     FROM inventory_consumptions ic
     INNER JOIN lots l ON l.id = ic.lot_id AND l.client_id = $1
     INNER JOIN inventory_items ii ON ii.id = ic.item_id AND ii.client_id = $1
     LEFT JOIN farms f ON f.id = ic.farm_id AND f.client_id = $1
     WHERE ${clauses.join(' AND ')}
     ORDER BY ic.cons_date DESC, ic.created_at DESC`,
    values
  );
  return res.rows;
}

async function getConsumptionHeaderForClient(db, id, clientId) {
  const res = await db.query(
    `SELECT ic.*
     FROM inventory_consumptions ic
     INNER JOIN lots l ON l.id = ic.lot_id AND l.client_id = $2
     INNER JOIN inventory_items ii ON ii.id = ic.item_id AND ii.client_id = $2
     WHERE ic.id = $1`,
    [id, clientId]
  );
  return res.rows[0] || null;
}

async function getInventoryConsumptionById({ clientId, id }) {
  const header = await getConsumptionHeaderForClient(pool, id, clientId);
  if (!header) return null;

  const layers = await pool.query(
    `SELECT cl.id, cl.layer_id, cl.qty_used, cl.unit_cost, cl.amount, cl.created_at,
            il.layer_date, il.movement_in_id
     FROM inventory_consumption_layers cl
     INNER JOIN inventory_layers il ON il.id = cl.layer_id AND il.client_id = $2
     WHERE cl.consumption_id = $1
     ORDER BY il.layer_date ASC, cl.created_at ASC`,
    [id, clientId]
  );

  const item = await pool.query(
    `SELECT name, unit FROM inventory_items WHERE id = $1 AND client_id = $2`,
    [header.item_id, clientId]
  );
  const lot = await pool.query(`SELECT name FROM lots WHERE id = $1 AND client_id = $2`, [
    header.lot_id,
    clientId,
  ]);
  let farmName = null;
  if (header.farm_id) {
    const fr = await pool.query(`SELECT name FROM farms WHERE id = $1 AND client_id = $2`, [
      header.farm_id,
      clientId,
    ]);
    farmName = fr.rows[0]?.name || null;
  }

  return {
    ...header,
    item_name: item.rows[0]?.name || null,
    item_unit: item.rows[0]?.unit || null,
    lot_name: lot.rows[0]?.name || null,
    farm_name: farmName,
    layers: layers.rows,
  };
}

/**
 * Crea un consumo y descuenta FIFO. Debe ejecutarse dentro de una transacción (`db`).
 */
async function createConsumptionFIFO(db, params) {
  const {
    clientId,
    userId,
    lotId,
    itemId,
    consDate,
    qty,
    notes,
    mixApplicationId,
    applicationGroupId,
    costScope,
    farmId,
  } = params;

  const qtyNeed = normalizePositiveQty(qty, 'qty');
  const cScope = costScope === 'farm' ? 'farm' : 'lot';
  const fId = farmId || null;
  const gId = applicationGroupId || null;

  const itemRes = await db.query(
    `SELECT id, name, unit, is_active FROM inventory_items WHERE id = $1 AND client_id = $2`,
    [itemId, clientId]
  );
  const item = itemRes.rows[0];
  if (!item || !item.is_active) {
    const err = new Error('El insumo no existe o está inactivo.');
    err.status = 409;
    throw err;
  }

  const layersRes = await db.query(
    `SELECT id, qty_remaining, unit_cost
     FROM inventory_layers
     WHERE item_id = $1
       AND client_id = $2
       AND is_active = true
       AND qty_remaining > 0
     ORDER BY layer_date ASC, created_at ASC, id ASC
     FOR UPDATE`,
    [itemId, clientId]
  );

  let remaining = qtyNeed;
  let totalCost = 0;
  const layerTakes = [];

  for (const layer of layersRes.rows) {
    if (remaining <= 0) break;
    const available = round3(Number(layer.qty_remaining));
    const take = round3(Math.min(available, remaining));
    if (take <= 0) continue;
    totalCost = round2(totalCost + take * Number(layer.unit_cost));
    layerTakes.push({ layerId: layer.id, take, unitCost: Number(layer.unit_cost) });
    remaining = round3(remaining - take);
  }

  if (remaining > 0.0001) {
    const qtyStr = Number(qtyNeed).toLocaleString('es-CR', { maximumFractionDigits: 3 });
    const err = new Error(
      `Stock insuficiente para este consumo: insumo «${item.name}» (${item.unit}), cantidad requerida: ${qtyStr} ${item.unit}.`
    );
    err.status = 409;
    throw err;
  }

  const ins = await db.query(
    `INSERT INTO inventory_consumptions (
       lot_id, harvest_id, expense_id, item_id, cons_date, qty, unit_cost_applied, notes,
       created_by_user_id, updated_by_user_id, is_active, mix_application_id,
       application_group_id, cost_scope, farm_id
     )
     VALUES ($1, NULL, NULL, $2, $3, $4, 0, $5, $6, $6, true, $7, $8, $9, $10)
     RETURNING id, lot_id, farm_id, cost_scope, application_group_id, item_id, cons_date, qty,
               unit_cost_applied, amount, notes, is_active, mix_application_id, created_at, updated_at`,
    [lotId, itemId, consDate, qtyNeed, notes || null, userId, mixApplicationId || null, gId, cScope, fId]
  );
  const consumptionId = ins.rows[0].id;

  for (const lt of layerTakes) {
    await db.query(
      `UPDATE inventory_layers
       SET qty_remaining = qty_remaining - $2::numeric,
           updated_at = NOW()
       WHERE id = $1
         AND client_id = $3`,
      [lt.layerId, lt.take, clientId]
    );
    await db.query(
      `INSERT INTO inventory_consumption_layers (consumption_id, layer_id, qty_used, unit_cost)
       VALUES ($1, $2, $3, $4)`,
      [consumptionId, lt.layerId, lt.take, lt.unitCost]
    );
  }

  const unitCostApplied = round2(totalCost / qtyNeed);
  await db.query(
    `UPDATE inventory_consumptions ic
     SET unit_cost_applied = $2,
         updated_by_user_id = $3,
         updated_at = NOW()
     WHERE ic.id = $1
       AND EXISTS (SELECT 1 FROM lots l WHERE l.id = ic.lot_id AND l.client_id = $4)`,
    [consumptionId, unitCostApplied, userId, clientId]
  );

  const final = await getConsumptionHeaderForClient(db, consumptionId, clientId);
  if (!final) {
    const err = new Error('Consumo no encontrado tras crear.');
    err.status = 500;
    throw err;
  }
  return final;
}

async function createDirectConsumption({
  clientId,
  userId,
  cost_scope,
  lot_id,
  farm_id,
  allocations,
  item_id,
  cons_date,
  qty,
  notes,
}) {
  const scope = normalizeScope(cost_scope, { required: true });
  const cleanLot = normalizeText(lot_id);
  const cleanFarm = normalizeText(farm_id);
  const cleanItem = normalizeText(item_id);
  const date = normalizeDate(cons_date, { required: true });
  assertScopeReferences({ scope, lotId: cleanLot, farmId: cleanFarm });

  if (!cleanItem) {
    const err = new Error('item_id es obligatorio.');
    err.status = 400;
    throw err;
  }

  const db = await pool.connect();
  try {
    await db.query('BEGIN');

    if (scope === 'lot') {
      await assertLotBelongsToClient(db, cleanLot, clientId);
      const row = await createConsumptionFIFO(db, {
        clientId,
        userId,
        lotId: cleanLot,
        itemId: cleanItem,
        consDate: date,
        qty,
        notes: normalizeText(notes),
        mixApplicationId: null,
        applicationGroupId: null,
        costScope: 'lot',
        farmId: null,
      });
      await db.query('COMMIT');
      return { consumptions: [await getInventoryConsumptionById({ clientId, id: row.id })], application_group_id: null };
    }

    const farm = await getFarmForClient(db, cleanFarm, clientId);
    const resolved = await allocationsService.resolveFarmAllocations({
      db,
      farmId: cleanFarm,
      clientId,
      laborAllocationMode: farm.labor_allocation_mode,
      allocations,
    });

    const totalQty = normalizePositiveQty(qty, 'qty');
    const parts = splitQtyByAllocations(totalQty, resolved);
    const applicationGroupId = randomUUID();
    const created = [];

    for (const part of parts) {
      if (!part.qty || part.qty <= 0) continue;
      await assertLotBelongsToClient(db, part.lot_id, clientId);
      const row = await createConsumptionFIFO(db, {
        clientId,
        userId,
        lotId: part.lot_id,
        itemId: cleanItem,
        consDate: date,
        qty: part.qty,
        notes: normalizeText(notes),
        mixApplicationId: null,
        applicationGroupId,
        costScope: 'farm',
        farmId: cleanFarm,
      });
      created.push(await getInventoryConsumptionById({ clientId, id: row.id }));
    }

    if (!created.length) {
      const err = new Error('No quedó cantidad asignada a ningún lote (revisá los porcentajes).');
      err.status = 400;
      throw err;
    }

    await db.query('COMMIT');
    return { consumptions: created, application_group_id: applicationGroupId };
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}

/** Tras inactivar consumos vinculados a una mezcla, alinea is_active de líneas y cabecera con el inventario real. */
async function syncMixApplicationStateFromConsumptions(db, clientId, userId, consumptionIds) {
  if (!consumptionIds || !consumptionIds.length) return;
  const pairsRes = await db.query(
    `SELECT DISTINCT ic.mix_application_id AS mix_application_id, ic.item_id AS item_id
     FROM inventory_consumptions ic
     INNER JOIN lots l ON l.id = ic.lot_id AND l.client_id = $2
     WHERE ic.id = ANY($1::uuid[])
       AND ic.mix_application_id IS NOT NULL`,
    [consumptionIds, clientId]
  );
  const pairs = pairsRes.rows;
  if (!pairs.length) return;

  for (const p of pairs) {
    await db.query(
      `UPDATE mix_application_items mai
       SET is_active = EXISTS (
             SELECT 1 FROM inventory_consumptions ic
             INNER JOIN lots l ON l.id = ic.lot_id AND l.client_id = $3
             WHERE ic.mix_application_id = mai.mix_application_id
               AND ic.item_id = mai.item_id
               AND ic.is_active = true
           ),
           updated_by_user_id = $4,
           updated_at = NOW()
       WHERE mai.mix_application_id = $1
         AND mai.item_id = $2
         AND EXISTS (
           SELECT 1 FROM mix_applications ma
           WHERE ma.id = mai.mix_application_id AND ma.client_id = $3
         )`,
      [p.mix_application_id, p.item_id, clientId, userId]
    );
  }

  const mixIds = [...new Set(pairs.map((r) => r.mix_application_id))];
  for (const mid of mixIds) {
    await db.query(
      `UPDATE mix_applications ma
       SET is_active = EXISTS (
             SELECT 1 FROM mix_application_items mai
             WHERE mai.mix_application_id = ma.id AND mai.is_active = true
           ),
           updated_by_user_id = $2,
           updated_at = NOW()
       WHERE ma.id = $1 AND ma.client_id = $3`,
      [mid, userId, clientId]
    );
  }
}

async function revertOneConsumptionLayers(db, consumptionId, clientId) {
  const layers = await db.query(
    `SELECT cl.layer_id, cl.qty_used
     FROM inventory_consumption_layers cl
     INNER JOIN inventory_layers il ON il.id = cl.layer_id AND il.client_id = $2
     WHERE cl.consumption_id = $1`,
    [consumptionId, clientId]
  );
  for (const cl of layers.rows) {
    await db.query(
      `UPDATE inventory_layers
       SET qty_remaining = qty_remaining + $2::numeric,
           updated_at = NOW()
       WHERE id = $1
         AND client_id = $3`,
      [cl.layer_id, Number(cl.qty_used), clientId]
    );
  }
}

async function updateInventoryConsumption({ clientId, userId, id, body }) {
  const current = await getConsumptionHeaderForClient(pool, id, clientId);
  if (!current) return null;

  if (current.application_group_id && Object.prototype.hasOwnProperty.call(body || {}, 'lot_id')) {
    const err = new Error('No se puede cambiar el lote en consumos prorrateados por finca.');
    err.status = 400;
    throw err;
  }

  const allowed = ['lot_id', 'cons_date', 'notes'];
  const updates = [];
  const values = [];
  let idx = 1;

  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(body || {}, key)) continue;
    if (key === 'lot_id') {
      const v = normalizeText(body.lot_id);
      if (!v) {
        const err = new Error('lot_id no puede quedar vacío.');
        err.status = 400;
        throw err;
      }
      await assertLotBelongsToClient(pool, v, clientId);
      updates.push(`lot_id = $${idx++}`);
      values.push(v);
    } else if (key === 'cons_date') {
      const v = normalizeDate(body.cons_date, { required: true, field: 'cons_date' });
      updates.push(`cons_date = $${idx++}`);
      values.push(v);
    } else if (key === 'notes') {
      updates.push(`notes = $${idx++}`);
      values.push(normalizeText(body.notes));
    }
  }

  if (!updates.length) {
    const err = new Error('No hay campos permitidos para actualizar.');
    err.status = 400;
    throw err;
  }

  updates.push(`updated_by_user_id = $${idx++}`);
  values.push(userId);
  updates.push(`updated_at = NOW()`);
  const idParam = idx++;
  values.push(id);
  const clientParam = idx++;
  values.push(clientId);

  const res = await pool.query(
    `UPDATE inventory_consumptions ic
     SET ${updates.join(', ')}
     WHERE ic.id = $${idParam}
       AND EXISTS (SELECT 1 FROM lots l WHERE l.id = ic.lot_id AND l.client_id = $${clientParam})
     RETURNING ic.*`,
    values
  );

  if (!res.rows[0]) return null;
  return getInventoryConsumptionById({ clientId, id });
}

async function deactivateInventoryConsumption({ clientId, userId, id }) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');

    const head = await db.query(
      `SELECT ic.id, ic.is_active, ic.application_group_id
       FROM inventory_consumptions ic
       WHERE ic.id = $1
         AND EXISTS (SELECT 1 FROM lots l WHERE l.id = ic.lot_id AND l.client_id = $2)
       FOR UPDATE`,
      [id, clientId]
    );
    const row = head.rows[0];
    if (!row) {
      await db.query('ROLLBACK');
      return null;
    }
    if (!row.is_active) {
      const err = new Error('El consumo ya está inactivo.');
      err.status = 409;
      throw err;
    }

    const groupId = row.application_group_id;
    const idRes = await db.query(
      `SELECT ic.id
       FROM inventory_consumptions ic
       INNER JOIN lots l ON l.id = ic.lot_id AND l.client_id = $2
       WHERE ic.is_active = true
         AND (
           ic.id = $1
           OR (
             $3::uuid IS NOT NULL
             AND ic.application_group_id IS NOT NULL
             AND ic.application_group_id = $3::uuid
           )
         )
       ORDER BY ic.id
       FOR UPDATE`,
      [id, clientId, groupId]
    );
    const ids = idRes.rows.map((r) => r.id);

    for (const cid of ids) {
      await revertOneConsumptionLayers(db, cid, clientId);
      await db.query(
        `UPDATE inventory_consumptions
         SET is_active = false,
             updated_by_user_id = $2,
             updated_at = NOW()
         WHERE id = $1`,
        [cid, userId]
      );
    }

    await syncMixApplicationStateFromConsumptions(db, clientId, userId, ids);

    await db.query('COMMIT');
    return getInventoryConsumptionById({ clientId, id });
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}

/** Alinea todas las líneas y la cabecera de una mezcla con el estado real de consumos (p. ej. datos previos a la sincronización). */
async function reconcileMixApplicationLinesAndHeader(db, clientId, userId, mixApplicationId) {
  await db.query(
    `UPDATE mix_application_items mai
     SET is_active = EXISTS (
           SELECT 1 FROM inventory_consumptions ic
           INNER JOIN lots l ON l.id = ic.lot_id AND l.client_id = $2
           WHERE ic.mix_application_id = mai.mix_application_id
             AND ic.item_id = mai.item_id
             AND ic.is_active = true
         ),
         updated_by_user_id = $3,
         updated_at = NOW()
     WHERE mai.mix_application_id = $1
       AND EXISTS (
         SELECT 1 FROM mix_applications ma
         WHERE ma.id = mai.mix_application_id AND ma.client_id = $2
       )`,
    [mixApplicationId, clientId, userId]
  );
  await db.query(
    `UPDATE mix_applications ma
     SET is_active = EXISTS (
           SELECT 1 FROM mix_application_items mai
           WHERE mai.mix_application_id = ma.id AND mai.is_active = true
         ),
         updated_by_user_id = $2,
         updated_at = NOW()
     WHERE ma.id = $1 AND ma.client_id = $3`,
    [mixApplicationId, userId, clientId]
  );
}

/** Inactiva todos los consumos de inventario vinculados a la mezcla (revierte capas FIFO) y sincroniza cabecera/líneas. */
async function deactivateMixApplication({ clientId, userId, mixApplicationId }) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const mixChk = await db.query(
      `SELECT id FROM mix_applications WHERE id = $1 AND client_id = $2 FOR UPDATE`,
      [mixApplicationId, clientId]
    );
    if (!mixChk.rows[0]) {
      await db.query('ROLLBACK');
      return null;
    }

    const idRes = await db.query(
      `SELECT ic.id
       FROM inventory_consumptions ic
       INNER JOIN lots l ON l.id = ic.lot_id AND l.client_id = $2
       WHERE ic.mix_application_id = $1 AND ic.is_active = true
       ORDER BY ic.id
       FOR UPDATE`,
      [mixApplicationId, clientId]
    );
    const ids = idRes.rows.map((r) => r.id);

    if (ids.length) {
      for (const cid of ids) {
        await revertOneConsumptionLayers(db, cid, clientId);
        await db.query(
          `UPDATE inventory_consumptions
           SET is_active = false,
               updated_by_user_id = $2,
               updated_at = NOW()
           WHERE id = $1`,
          [cid, userId]
        );
      }
      await syncMixApplicationStateFromConsumptions(db, clientId, userId, ids);
    } else {
      await reconcileMixApplicationLinesAndHeader(db, clientId, userId, mixApplicationId);
    }

    await db.query('COMMIT');
    return { mix_application_id: mixApplicationId, deactivated_consumption_count: ids.length };
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}

module.exports = {
  listInventoryConsumptions,
  getInventoryConsumptionById,
  createDirectConsumption,
  updateInventoryConsumption,
  deactivateInventoryConsumption,
  deactivateMixApplication,
  createConsumptionFIFO,
  assertLotBelongsToClient,
  getFarmForClient,
  splitQtyByAllocations,
};
