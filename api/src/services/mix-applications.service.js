const { pool } = require('../db');
const { convertQtyToItemUnit, round3 } = require('../lib/inventory-unit-convert');
const allocationsService = require('./labor-entry-allocations.service');
const {
  createConsumptionFIFO,
  assertLotBelongsToClient,
  getFarmForClient,
  splitQtyByAllocations,
} = require('./inventory-consumptions.service');

function normalizeText(value) {
  if (value == null) return null;
  const v = String(value).trim();
  return v || null;
}

function normalizeDate(value, { required = false, field = 'app_date' } = {}) {
  if (value === undefined && !required) return undefined;
  const v = String(value || '').trim();
  if (!v) {
    const err = new Error(`${field} es obligatorio.`);
    err.status = 400;
    throw err;
  }
  return v.slice(0, 10);
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

async function listMixApplications({ clientId, active, lotId, farmId, fromDate, toDate }) {
  const clauses = ['ma.client_id = $1'];
  const values = [clientId];
  let idx = 2;

  if (lotId) {
    clauses.push(`ma.lot_id = $${idx++}`);
    values.push(lotId);
  }
  if (farmId) {
    clauses.push(`ma.farm_id = $${idx++}`);
    values.push(farmId);
  }
  if (fromDate) {
    clauses.push(`ma.app_date >= $${idx++}`);
    values.push(String(fromDate).slice(0, 10));
  }
  if (toDate) {
    clauses.push(`ma.app_date <= $${idx++}`);
    values.push(String(toDate).slice(0, 10));
  }

  let mode = 'active';
  if (active === false) mode = 'inactive';
  else if (active === 'all') mode = 'all';
  else if (active === true) mode = 'active';
  else mode = 'active';

  if (mode === 'active') {
    clauses.push(`ma.is_active = $${idx++}`);
    values.push(true);
    clauses.push(`EXISTS (
      SELECT 1 FROM inventory_consumptions ic
      INNER JOIN lots l ON l.id = ic.lot_id AND l.client_id = ma.client_id
      WHERE ic.mix_application_id = ma.id AND ic.is_active = true
    )`);
  } else if (mode === 'inactive') {
    clauses.push(`ma.is_active = $${idx++}`);
    values.push(false);
  }

  const res = await pool.query(
    `SELECT ma.*,
            CASE WHEN ma.cost_scope = 'farm' THEN f.name ELSE l.name END AS scope_name,
            l.name AS lot_name,
            f.name AS farm_name,
            EXISTS (
              SELECT 1 FROM inventory_consumptions ic
              INNER JOIN lots l2 ON l2.id = ic.lot_id AND l2.client_id = ma.client_id
              WHERE ic.mix_application_id = ma.id AND ic.is_active = true
            ) AS has_active_consumptions,
            (SELECT COALESCE(SUM(ic2.amount), 0)::numeric
               FROM inventory_consumptions ic2
               INNER JOIN lots lsum ON lsum.id = ic2.lot_id AND lsum.client_id = ma.client_id
              WHERE ic2.mix_application_id = ma.id) AS total_cost_crc
     FROM mix_applications ma
     LEFT JOIN lots l ON l.id = ma.lot_id AND l.client_id = ma.client_id
     LEFT JOIN farms f ON f.id = ma.farm_id AND f.client_id = ma.client_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY ma.app_date DESC, ma.created_at DESC`,
    values
  );
  return res.rows;
}

async function getMixApplicationById({ clientId, id }) {
  const headerRes = await pool.query(
    `SELECT ma.*,
            CASE WHEN ma.cost_scope = 'farm' THEN f.name ELSE l.name END AS scope_name,
            l.name AS lot_name,
            f.name AS farm_name,
            EXISTS (
              SELECT 1 FROM inventory_consumptions ic
              INNER JOIN lots l2 ON l2.id = ic.lot_id AND l2.client_id = ma.client_id
              WHERE ic.mix_application_id = ma.id AND ic.is_active = true
            ) AS has_active_consumptions
     FROM mix_applications ma
     LEFT JOIN lots l ON l.id = ma.lot_id AND l.client_id = ma.client_id
     LEFT JOIN farms f ON f.id = ma.farm_id AND f.client_id = ma.client_id
     WHERE ma.id = $1 AND ma.client_id = $2`,
    [id, clientId]
  );
  const ma = headerRes.rows[0];
  if (!ma) return null;

  const itemsRes = await pool.query(
    `SELECT mai.id,
            mai.item_id,
            mai.dose_qty,
            mai.dose_unit,
            mai.dose_qty_base,
            EXISTS (
              SELECT 1 FROM inventory_consumptions ic
              INNER JOIN lots l2 ON l2.id = ic.lot_id AND l2.client_id = $2
              WHERE ic.mix_application_id = mai.mix_application_id
                AND ic.item_id = mai.item_id
                AND ic.is_active = true
            ) AS line_active,
            ii.name AS item_name,
            ii.unit AS item_unit
     FROM mix_application_items mai
     INNER JOIN mix_applications m0 ON m0.id = mai.mix_application_id AND m0.client_id = $2
     INNER JOIN inventory_items ii ON ii.id = mai.item_id AND ii.client_id = $2
     WHERE mai.mix_application_id = $1
     ORDER BY ii.name ASC`,
    [id, clientId]
  );

  const containers = Number(ma.containers_used);
  const items = itemsRes.rows.map((row) => ({
    id: row.id,
    item_id: row.item_id,
    item_name: row.item_name,
    item_unit: row.item_unit,
    dose_qty: row.dose_qty,
    dose_unit: row.dose_unit,
    dose_qty_base: row.dose_qty_base,
    line_active: row.line_active,
    total_qty: round3(Number(row.dose_qty_base || 0) * (Number.isFinite(containers) ? containers : 0)),
  }));

  return { ...ma, items };
}

async function createMixApplication({ clientId, userId, body }) {
  const scope = normalizeScope(body?.cost_scope, { required: true });
  const lotId = normalizeText(body?.lot_id);
  const farmId = normalizeText(body?.farm_id);
  const appDate = normalizeDate(body?.app_date, { required: true, field: 'app_date' });
  const notes = normalizeText(body?.notes);
  const containersUsed = Number(body?.containers_used);

  assertScopeReferences({ scope, lotId, farmId });

  if (!Number.isFinite(containersUsed) || containersUsed <= 0) {
    const err = new Error('containers_used debe ser mayor que 0.');
    err.status = 400;
    throw err;
  }

  const items = Array.isArray(body?.items) ? body.items : null;
  if (!items || !items.length) {
    const err = new Error('Debe incluir al menos un insumo en la mezcla.');
    err.status = 400;
    throw err;
  }

  const db = await pool.connect();
  try {
    await db.query('BEGIN');

    let resolvedAllocations = null;
    if (scope === 'farm') {
      const farm = await getFarmForClient(db, farmId, clientId);
      resolvedAllocations = await allocationsService.resolveFarmAllocations({
        db,
        farmId,
        clientId,
        laborAllocationMode: farm.labor_allocation_mode,
        allocations: body?.allocations,
      });
    } else {
      await assertLotBelongsToClient(db, lotId, clientId);
    }

    const mixIns = await db.query(
      `INSERT INTO mix_applications (
         lot_id, farm_id, cost_scope, harvest_id, expense_id, app_date, containers_used, notes,
         client_id, created_by_user_id, updated_by_user_id, is_active
       )
       VALUES ($1, $2, $3, NULL, NULL, $4, $5, $6, $7, $8, $8, true)
       RETURNING id`,
      [
        scope === 'lot' ? lotId : null,
        scope === 'farm' ? farmId : null,
        scope,
        appDate,
        containersUsed,
        notes,
        clientId,
        userId,
      ]
    );
    const mixApplicationId = mixIns.rows[0].id;

    const summary = [];

    for (const raw of items) {
      const itemId = normalizeText(raw?.item_id);
      const doseQty = Number(raw?.dose_qty);
      const doseUnit = normalizeText(raw?.dose_unit);
      if (!itemId || !doseUnit) {
        const err = new Error('Cada ítem debe tener item_id y dose_unit.');
        err.status = 400;
        throw err;
      }
      if (!Number.isFinite(doseQty) || doseQty <= 0) {
        const err = new Error('La dosis por envase de cada insumo debe ser mayor que cero.');
        err.status = 400;
        throw err;
      }

      const itemRow = await db.query(
        `SELECT id, unit, is_active FROM inventory_items WHERE id = $1 AND client_id = $2`,
        [itemId, clientId]
      );
      const item = itemRow.rows[0];
      if (!item || !item.is_active) {
        const err = new Error(`Insumo ${itemId} no encontrado o inactivo.`);
        err.status = 409;
        throw err;
      }

      const doseQtyBase = convertQtyToItemUnit(doseQty, doseUnit, item.unit);
      const totalQty = round3(Number(doseQtyBase) * Number(containersUsed));
      if (!Number.isFinite(totalQty) || totalQty <= 0) {
        const err = new Error('La cantidad total calculada debe ser mayor que 0.');
        err.status = 400;
        throw err;
      }

      await db.query(
        `INSERT INTO mix_application_items (
           mix_application_id, item_id, dose_qty, dose_unit, dose_qty_base,
           created_by_user_id, updated_by_user_id, is_active
         )
         VALUES ($1, $2, $3, $4, $5, $6, $6, true)`,
        [mixApplicationId, itemId, doseQty, doseUnit, doseQtyBase, userId]
      );

      if (scope === 'lot') {
        const consumption = await createConsumptionFIFO(db, {
          clientId,
          userId,
          lotId,
          itemId,
          consDate: appDate,
          qty: totalQty,
          notes: notes || null,
          mixApplicationId,
          applicationGroupId: null,
          costScope: 'lot',
          farmId: null,
        });
        summary.push({
          item_id: itemId,
          lot_id: lotId,
          consumption_id: consumption.id,
          qty: consumption.qty,
          unit_cost_applied: consumption.unit_cost_applied,
          amount: consumption.amount,
        });
      } else {
        const parts = splitQtyByAllocations(totalQty, resolvedAllocations);
        for (const part of parts) {
          if (!part.qty || part.qty <= 0) continue;
          await assertLotBelongsToClient(db, part.lot_id, clientId);
          const consumption = await createConsumptionFIFO(db, {
            clientId,
            userId,
            lotId: part.lot_id,
            itemId,
            consDate: appDate,
            qty: part.qty,
            notes: notes || null,
            mixApplicationId,
            applicationGroupId: null,
            costScope: 'farm',
            farmId,
          });
          summary.push({
            item_id: itemId,
            lot_id: part.lot_id,
            consumption_id: consumption.id,
            qty: consumption.qty,
            unit_cost_applied: consumption.unit_cost_applied,
            amount: consumption.amount,
          });
        }
      }
    }

    await db.query('COMMIT');
    return { mix_application_id: mixApplicationId, items: summary };
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}

module.exports = {
  createMixApplication,
  listMixApplications,
  getMixApplicationById,
};
