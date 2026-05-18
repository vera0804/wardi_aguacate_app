const { pool } = require('../db');

const ALLOWED_CURRENCIES = new Set(['CRC', 'USD']);
/** 1 litro = 33,81 onzas líquidas (fl oz). */
const FL_OZ_PER_LITER = 33.81;
/** 1 kg = 35,274 onzas de masa (oz). */
const OZ_MASS_PER_KG = 35.274;

const UNIT_ALIASES = {
  cc: 'cc',
  ml: 'cc',
  ccs: 'cc',
  litro: 'litro',
  litros: 'litro',
  l: 'litro',
  lt: 'litro',
  kg: 'kg',
  kilo: 'kg',
  kilos: 'kg',
  kilogramo: 'kg',
  kilogramos: 'kg',
  gramo: 'gramo',
  gramos: 'gramo',
  g: 'gramo',
  'onza_liquida': 'onza_liquida',
  'onza_liquidas': 'onza_liquida',
  'onzas_liquidas': 'onza_liquida',
  'onza_líquida': 'onza_liquida',
  'onzas_líquidas': 'onza_liquida',
  fl_oz: 'onza_liquida',
  floz: 'onza_liquida',
  oz_liquida: 'onza_liquida',
  'onza_masa': 'onza_masa',
  'onza_masas': 'onza_masa',
  'onzas_masa': 'onza_masa',
  'onza_de_masa': 'onza_masa',
  oz_masa: 'onza_masa',
  onza: 'onza',
  onzas: 'onza',
  oz: 'onza',
  unidad: 'unidad',
  unidades: 'unidad',
  und: 'unidad',
  un: 'unidad',
};

function normalizeText(value) {
  if (value == null) return null;
  const v = String(value).trim();
  return v || null;
}

function normalizeDate(value, { required = false, field = 'mov_date' } = {}) {
  if (value === undefined && !required) return undefined;
  const v = String(value || '').trim();
  if (!v) {
    const err = new Error(`${field} es obligatorio.`);
    err.status = 400;
    throw err;
  }
  return v;
}

function normalizePositive(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    const err = new Error(`${field} debe ser mayor que 0.`);
    err.status = 400;
    throw err;
  }
  return n;
}

function normalizeNonNegativeOptional(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    const err = new Error(`${field} debe ser mayor o igual a 0.`);
    err.status = 400;
    throw err;
  }
  return n;
}

function normalizeCurrency(value) {
  const c = String(value || 'CRC').trim().toUpperCase();
  if (!ALLOWED_CURRENCIES.has(c)) {
    const err = new Error('currency debe ser CRC o USD.');
    err.status = 400;
    throw err;
  }
  return c;
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function round3(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
}

function normalizeUnit(value, field = 'unit') {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) {
    const err = new Error(`${field} es obligatorio.`);
    err.status = 400;
    throw err;
  }
  return UNIT_ALIASES[raw] || raw;
}

/** "onza" sin calificar: según la otra unidad (volumen vs masa). */
function resolveAmbiguousOnza(otherUnit) {
  const vol = new Set(['litro', 'cc', 'onza_liquida']);
  const mass = new Set(['kg', 'gramo', 'onza_masa']);
  const o = otherUnit;
  if (vol.has(o)) return 'onza_liquida';
  if (mass.has(o)) return 'onza_masa';
  return 'onza_masa';
}

function convertQty(qty, fromUnit, toUnit) {
  let from = normalizeUnit(fromUnit, 'pack_unit');
  let to = normalizeUnit(toUnit, 'item_unit');
  const n = normalizePositive(qty, 'qty');
  if (from === 'onza') from = resolveAmbiguousOnza(to);
  if (to === 'onza') to = resolveAmbiguousOnza(from);
  if (from === to) return n;

  if (from === 'cc' && to === 'litro') return round3(n / 1000);
  if (from === 'litro' && to === 'cc') return round3(n * 1000);
  if (from === 'gramo' && to === 'kg') return round3(n / 1000);
  if (from === 'kg' && to === 'gramo') return round3(n * 1000);

  // Onza líquida (volumen) ↔ litro / cc
  if (from === 'onza_liquida' && to === 'litro') return round3(n / FL_OZ_PER_LITER);
  if (from === 'litro' && to === 'onza_liquida') return round3(n * FL_OZ_PER_LITER);
  if (from === 'onza_liquida' && to === 'cc') return round3((n / FL_OZ_PER_LITER) * 1000);
  if (from === 'cc' && to === 'onza_liquida') return round3((n / 1000) * FL_OZ_PER_LITER);

  // Onza de masa ↔ kg / gramo (1 kg = 35,274 oz)
  if (from === 'onza_masa' && to === 'kg') return round3(n / OZ_MASS_PER_KG);
  if (from === 'kg' && to === 'onza_masa') return round3(n * OZ_MASS_PER_KG);
  if (from === 'onza_masa' && to === 'gramo') return round3((n / OZ_MASS_PER_KG) * 1000);
  if (from === 'gramo' && to === 'onza_masa') return round3((n / 1000) * OZ_MASS_PER_KG);

  // Compatibilidad: onza de masa con constante clásica g/oz (equiv. aprox. a la cadena kg)
  if (from === 'onza' && to === 'gramo') return round3(n * (1000 / OZ_MASS_PER_KG));
  if (from === 'gramo' && to === 'onza') return round3(n / (1000 / OZ_MASS_PER_KG));
  if (from === 'onza' && to === 'kg') return round3(n / OZ_MASS_PER_KG);
  if (from === 'kg' && to === 'onza') return round3(n * OZ_MASS_PER_KG);

  if (from === 'unidad' || to === 'unidad') {
    const err = new Error('unidad solo puede convertirse a unidad.');
    err.status = 400;
    throw err;
  }

  const err = new Error(
    `No existe conversión soportada de ${from} a ${to}. Usa "onza líquida" con litros/cc, o "onza de masa" con kg/gramos.`
  );
  err.status = 400;
  throw err;
}

async function getActiveItemById({ db, itemId, clientId }) {
  const res = await db.query(
    `SELECT i.id, i.name, i.unit, i.is_active, i.client_id, c.name AS category_name, b.name AS brand_name
     FROM inventory_items i
     LEFT JOIN inventory_categories c ON c.id = i.category_id
     LEFT JOIN inventory_brands b ON b.id = i.brand_id AND b.client_id = i.client_id
     WHERE i.id = $1
       AND i.client_id = $2`,
    [itemId, clientId]
  );
  const row = res.rows[0] || null;
  if (!row || !row.is_active) {
    const err = new Error('El insumo no existe o está inactivo.');
    err.status = 409;
    throw err;
  }
  return row;
}

async function getCurrentStock({ db, itemId, clientId }) {
  const res = await db.query(
    `SELECT COALESCE(SUM(qty_remaining), 0)::numeric(14,3) AS stock
     FROM inventory_layers
     WHERE item_id = $1
       AND client_id = $2
       AND is_active = true`,
    [itemId, clientId]
  );
  return Number(res.rows[0]?.stock || 0);
}

/** Capa más antigua (FIFO) para ajustes físicos al alza: se suma cantidad y se hereda su costo unitario. */
async function getOldestActiveLayerForItem({ db, clientId, itemId }) {
  const res = await db.query(
    `SELECT id, unit_cost, qty_in, qty_remaining, layer_date, movement_in_id
     FROM inventory_layers
     WHERE client_id = $1
       AND item_id = $2
       AND is_active = true
     ORDER BY layer_date ASC, created_at ASC, id ASC
     LIMIT 1
     FOR UPDATE`,
    [clientId, itemId]
  );
  return res.rows[0] || null;
}

function resolveQtyBase({ qty, packCount, packSize, packUnit, itemUnit }) {
  const hasPack =
    packCount !== undefined &&
    packCount !== null &&
    packCount !== '' &&
    packSize !== undefined &&
    packSize !== null &&
    packSize !== '' &&
    packUnit !== undefined &&
    packUnit !== null &&
    String(packUnit).trim() !== '';
  if (!hasPack) return normalizePositive(qty, 'qty');

  const pc = normalizeNonNegativeOptional(packCount, 'pack_count');
  const ps = normalizeNonNegativeOptional(packSize, 'pack_size');
  const pu = normalizeText(packUnit);
  if (pc == null || ps == null || !pu) {
    const err = new Error('Para modo por envase debes enviar pack_count, pack_size y pack_unit.');
    err.status = 400;
    throw err;
  }
  const inPackUnit = Number(pc) * Number(ps);
  if (!Number.isFinite(inPackUnit) || inPackUnit <= 0) {
    const err = new Error('Cantidad por envase inválida.');
    err.status = 400;
    throw err;
  }
  return convertQty(inPackUnit, pu, itemUnit);
}

function computeCostsInCrc({
  qtyBase,
  packCount,
  packCost,
  currency,
  fxRate,
  unitCost,
  totalCost,
  unitCostUsd,
  totalCostUsd,
}) {
  const c = normalizeCurrency(currency);
  const pc = normalizeNonNegativeOptional(packCount, 'pack_count');
  const pCost = normalizeNonNegativeOptional(packCost, 'pack_cost');
  const rate = normalizeNonNegativeOptional(fxRate, 'fx_rate');
  const uc = normalizeNonNegativeOptional(unitCost, 'unit_cost');
  const tc = normalizeNonNegativeOptional(totalCost, 'total_cost');
  const ucUsd = normalizeNonNegativeOptional(unitCostUsd, 'unit_cost_usd');
  const tcUsd = normalizeNonNegativeOptional(totalCostUsd, 'total_cost_usd');

  if (c === 'USD') {
    if (!(rate > 0)) {
      const err = new Error('En moneda USD, fx_rate es obligatorio y mayor a 0.');
      err.status = 400;
      throw err;
    }
    let totalUsd = tcUsd != null ? tcUsd : tc;
    if (totalUsd == null && pc != null && pCost != null) totalUsd = round2(Number(pc) * Number(pCost));
    const effectiveUnitUsd = ucUsd != null ? ucUsd : uc;
    if (totalUsd == null && effectiveUnitUsd != null) {
      totalUsd = round2(Number(effectiveUnitUsd) * Number(qtyBase));
    }
    if (totalUsd == null) {
      const err = new Error('En USD debes enviar total_cost_usd o unit_cost_usd.');
      err.status = 400;
      throw err;
    }
    const totalCrc = round2(Number(totalUsd) * Number(rate));
    const unitCrc = round2(totalCrc / Number(qtyBase));
    return {
      currency: c,
      fxRate: rate,
      unitCostCrc: unitCrc,
      totalCostCrc: totalCrc,
      unitCostUsd:
        effectiveUnitUsd != null ? effectiveUnitUsd : round2(totalUsd / Number(qtyBase)),
      totalCostUsd: totalUsd,
    };
  }

  let totalCrc = tc;
  if (totalCrc == null && pc != null && pCost != null) totalCrc = round2(Number(pc) * Number(pCost));
  if (totalCrc == null && uc != null) totalCrc = round2(Number(uc) * Number(qtyBase));
  if (totalCrc == null) {
    const err = new Error('En CRC debes enviar total_cost o unit_cost.');
    err.status = 400;
    throw err;
  }
  const unitCrc = round2(totalCrc / Number(qtyBase));
  return {
    currency: c,
    fxRate: null,
    unitCostCrc: unitCrc,
    totalCostCrc: totalCrc,
    unitCostUsd: null,
    totalCostUsd: null,
  };
}

const OUT_NOTES_MIN_LEN = 5;

async function consumeSpecificLayer({ db, clientId, itemId, layerId, qtyToConsume, movementId }) {
  const qty = normalizePositive(qtyToConsume, 'qty');
  const lr = await db.query(
    `SELECT id, qty_remaining, unit_cost
     FROM inventory_layers
     WHERE id = $1
       AND client_id = $2
       AND item_id = $3
       AND is_active = true
       AND qty_remaining > 0
     FOR UPDATE`,
    [layerId, clientId, itemId]
  );
  const layer = lr.rows[0];
  if (!layer) {
    const err = new Error(
      'La capa (lote) seleccionada no existe, no pertenece a este insumo o no tiene saldo disponible.'
    );
    err.status = 400;
    throw err;
  }
  const available = Number(layer.qty_remaining);
  if (qty > available + 0.0001) {
    const err = new Error('La cantidad supera el saldo disponible en la capa seleccionada.');
    err.status = 409;
    throw err;
  }
  const take = qty;
  const uc = Number(layer.unit_cost);
  await db.query(
    `UPDATE inventory_layers
     SET qty_remaining = qty_remaining - $2::numeric,
         updated_at = NOW()
     WHERE id = $1
       AND client_id = $3`,
    [layer.id, take, clientId]
  );
  await db.query(
    `INSERT INTO inventory_movement_layers (movement_id, layer_id, qty_used, unit_cost, created_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [movementId, layer.id, take, uc]
  );
  const grossTotal = round2(take * uc);
  const unitCostGross = round2(grossTotal / take);
  return { grossTotal, unitCostGross, consumed: [{ layer_id: layer.id, qty_used: take, unit_cost: uc }] };
}

async function consumeFifoLayers({ db, clientId, itemId, qtyToConsume, movementId }) {
  let remaining = Number(qtyToConsume);
  const consumed = [];
  const layersRes = await db.query(
    `SELECT id, qty_remaining, unit_cost
     FROM inventory_layers
     WHERE client_id = $1
       AND item_id = $2
       AND is_active = true
       AND qty_remaining > 0
     ORDER BY layer_date ASC, created_at ASC, id ASC
     FOR UPDATE`,
    [clientId, itemId]
  );

  for (const layer of layersRes.rows) {
    if (remaining <= 0) break;
    const available = Number(layer.qty_remaining);
    const take = Math.min(available, remaining);
    const nextRemaining = round2(available - take);
    await db.query(
      `UPDATE inventory_layers
       SET qty_remaining = $2,
           updated_at = NOW()
       WHERE id = $1
         AND client_id = $3`,
      [layer.id, nextRemaining, clientId]
    );
    await db.query(
      `INSERT INTO inventory_movement_layers (movement_id, layer_id, qty_used, unit_cost, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [movementId, layer.id, take, Number(layer.unit_cost)]
    );
    consumed.push({ layer_id: layer.id, qty_used: take, unit_cost: Number(layer.unit_cost) });
    remaining = round2(remaining - take);
  }

  if (remaining > 0) {
    const err = new Error('Stock insuficiente para completar la salida.');
    err.status = 409;
    throw err;
  }

  const totalCost = round2(
    consumed.reduce((acc, x) => acc + Number(x.qty_used) * Number(x.unit_cost), 0)
  );
  const unitCost = round2(totalCost / Number(qtyToConsume));
  return { consumed, totalCost, unitCost };
}

async function revertFifoConsumption({ db, movementId, clientId }) {
  const rows = await db.query(
    `SELECT ml.layer_id, ml.qty_used
     FROM inventory_movement_layers ml
     INNER JOIN inventory_layers l ON l.id = ml.layer_id AND l.client_id = $2
     WHERE ml.movement_id = $1
     ORDER BY ml.created_at DESC, ml.id DESC`,
    [movementId, clientId]
  );
  for (const row of rows.rows) {
    await db.query(
      `UPDATE inventory_layers
       SET qty_remaining = qty_remaining + $2,
           updated_at = NOW()
       WHERE id = $1
         AND client_id = $3`,
      [row.layer_id, Number(row.qty_used), clientId]
    );
  }
}

async function getMovementById({ db, id, clientId }) {
  const res = await db.query(
    `SELECT m.*, i.name AS item_name, i.unit AS item_unit,
            src_in.mov_date AS source_inbound_mov_date,
            src_in.pack_label AS source_inbound_pack_label,
            src_in.pack_count AS source_inbound_pack_count,
            src_in.pack_size AS source_inbound_pack_size,
            src_in.pack_unit AS source_inbound_pack_unit,
            src_in.pack_cost AS source_inbound_pack_cost,
            src_in.currency AS source_inbound_currency,
            src_in.fx_rate AS source_inbound_fx_rate,
            src_in.unit_cost AS source_inbound_unit_cost_crc,
            src_in.total_cost AS source_inbound_total_cost_crc,
            src_in.unit_cost_usd AS source_inbound_unit_cost_usd,
            src_in.total_cost_usd AS source_inbound_total_cost_usd
     FROM inventory_movements m
     JOIN inventory_items i ON i.id = m.item_id AND i.client_id = m.client_id
     LEFT JOIN inventory_layers src_l ON src_l.id = m.out_source_layer_id AND src_l.client_id = m.client_id
     LEFT JOIN inventory_movements src_in ON src_in.id = src_l.movement_in_id AND src_in.client_id = m.client_id
     WHERE m.id = $1
       AND m.client_id = $2`,
    [id, clientId]
  );
  return res.rows[0] || null;
}

async function listMovements({ clientId, filters }) {
  const q = filters || {};
  const clauses = ['m.client_id = $1'];
  const values = [clientId];
  let idx = 2;
  if (q.itemId) {
    clauses.push(`m.item_id = $${idx++}`);
    values.push(q.itemId);
  }
  if (q.movement) {
    clauses.push(`m.movement = $${idx++}::movement_type`);
    values.push(q.movement);
  }
  if (q.fromDate) {
    clauses.push(`m.mov_date >= $${idx++}`);
    values.push(q.fromDate);
  }
  if (q.toDate) {
    clauses.push(`m.mov_date <= $${idx++}`);
    values.push(q.toDate);
  }
  if (q.active !== undefined) {
    clauses.push(`m.is_active = $${idx++}`);
    values.push(q.active);
  }
  const res = await pool.query(
    `SELECT m.id, m.item_id, m.mov_date, m.movement, m.qty, m.unit_cost, m.total_cost, m.notes,
            m.currency, m.fx_rate, m.unit_cost_usd, m.total_cost_usd, m.is_active,
            m.pack_label, m.pack_count, m.pack_size, m.pack_unit, m.pack_cost,
            m.out_source_layer_id, m.out_gross_total_crc, m.out_refund_crc,
            m.created_at, m.updated_at,
            i.name AS item_name, i.unit AS item_unit,
            il.qty_in AS inbound_layer_qty_in,
            il.qty_remaining AS inbound_layer_qty_remaining
     FROM inventory_movements m
     JOIN inventory_items i ON i.id = m.item_id AND i.client_id = m.client_id
     LEFT JOIN inventory_layers il ON il.movement_in_id = m.id AND il.client_id = m.client_id AND m.movement = 'in'::movement_type
     WHERE ${clauses.join(' AND ')}
     ORDER BY m.mov_date DESC, m.created_at DESC`,
    values
  );
  return res.rows;
}

async function getMovementLayers({ clientId, movementId }) {
  const movement = await getMovementById({ db: pool, id: movementId, clientId });
  if (!movement) return null;
  const layers = await pool.query(
    `SELECT ml.id, ml.movement_id, ml.layer_id, ml.qty_used, ml.unit_cost, ml.amount,
            l.layer_date, l.movement_in_id
     FROM inventory_movement_layers ml
     JOIN inventory_layers l ON l.id = ml.layer_id AND l.client_id = $2
     WHERE ml.movement_id = $1
     ORDER BY l.layer_date ASC, ml.created_at ASC`,
    [movementId, clientId]
  );
  return { movement, layers: layers.rows };
}

async function createMovement({ clientId, userId, payload, actorRole }) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const movement = String(payload?.movement || '').trim().toLowerCase();
    const actorRoleNorm = String(actorRole || 'admin').trim().toLowerCase();
    if (actorRoleNorm === 'operario' && movement !== 'in') {
      const err = new Error('Solo el administrador puede registrar salidas de inventario.');
      err.status = 403;
      throw err;
    }
    if (!['in', 'out'].includes(movement)) {
      const err = new Error("movement debe ser 'in' o 'out'.");
      err.status = 400;
      throw err;
    }
    const itemId = normalizeText(payload?.item_id);
    if (!itemId) {
      const err = new Error('item_id es obligatorio.');
      err.status = 400;
      throw err;
    }
    const item = await getActiveItemById({ db, itemId, clientId });
    const movDate = normalizeDate(payload?.mov_date, { required: true });
    const qtyBase = resolveQtyBase({
      qty: payload?.qty,
      packCount: payload?.pack_count,
      packSize: payload?.pack_size,
      packUnit: payload?.pack_unit,
      itemUnit: item.unit,
    });
    const notes = normalizeText(payload?.notes);
    const inboundCosts =
      movement === 'in'
        ? computeCostsInCrc({
            qtyBase,
            packCount: payload?.pack_count,
            packCost: payload?.pack_cost,
            currency: payload?.currency,
            fxRate: payload?.fx_rate,
            unitCost: payload?.unit_cost,
            totalCost: payload?.total_cost,
            unitCostUsd: payload?.unit_cost_usd,
            totalCostUsd: payload?.total_cost_usd,
          })
        : null;

    const insertRes = await db.query(
      `INSERT INTO inventory_movements (
         item_id, mov_date, movement, qty, unit_cost, total_cost, notes, pack_label, pack_count, pack_size, pack_unit, pack_cost,
         currency, fx_rate, unit_cost_usd, total_cost_usd, client_id, created_by_user_id, updated_by_user_id
       )
       VALUES ($1, $2, $3::movement_type, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $18)
       RETURNING id`,
      [
        itemId,
        movDate,
        movement,
        qtyBase,
        inboundCosts?.unitCostCrc ?? null,
        inboundCosts?.totalCostCrc ?? null,
        notes,
        normalizeText(payload?.pack_label),
        normalizeNonNegativeOptional(payload?.pack_count, 'pack_count'),
        normalizeNonNegativeOptional(payload?.pack_size, 'pack_size'),
        normalizeText(payload?.pack_unit),
        normalizeNonNegativeOptional(payload?.pack_cost, 'pack_cost'),
        inboundCosts?.currency ?? 'CRC',
        inboundCosts?.fxRate ?? null,
        inboundCosts?.unitCostUsd ?? null,
        inboundCosts?.totalCostUsd ?? null,
        clientId,
        userId,
      ]
    );
    const movementId = insertRes.rows[0].id;

    if (movement === 'in') {
      const costs = inboundCosts;
      await db.query(
        `INSERT INTO inventory_layers (
           item_id, movement_in_id, layer_date, qty_in, qty_remaining, unit_cost, is_active, client_id, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $4, $5, true, $6, NOW(), NOW())`,
        [itemId, movementId, movDate, qtyBase, costs.unitCostCrc, clientId]
      );
    } else {
      const notesNorm = notes;
      if (!notesNorm || String(notesNorm).trim().length < OUT_NOTES_MIN_LEN) {
        const err = new Error(
          `En salidas las observaciones son obligatorias (indique el motivo: vencido, mal estado, donación, etc.). Mínimo ${OUT_NOTES_MIN_LEN} caracteres.`
        );
        err.status = 400;
        throw err;
      }
      const sourceLayerId = normalizeText(payload?.source_layer_id);
      if (!sourceLayerId) {
        const err = new Error('Debe elegir la capa (lote) de la que sale la mercadería (source_layer_id).');
        err.status = 400;
        throw err;
      }
      let refundCr = 0;
      if (payload?.refund_crc !== undefined && payload?.refund_crc !== null && payload?.refund_crc !== '') {
        refundCr = round2(normalizeNonNegativeOptional(payload.refund_crc, 'refund_crc'));
      }
      const stock = await getCurrentStock({ db, itemId, clientId });
      if (stock < qtyBase) {
        const err = new Error('Stock insuficiente para la salida solicitada.');
        err.status = 409;
        throw err;
      }
      const spec = await consumeSpecificLayer({
        db,
        clientId,
        itemId,
        layerId: sourceLayerId,
        qtyToConsume: qtyBase,
        movementId,
      });
      const grossTotal = spec.grossTotal;
      if (refundCr > grossTotal + 0.01) {
        const err = new Error('El reintegro en colones no puede superar el costo bruto de la salida en esa capa.');
        err.status = 400;
        throw err;
      }
      const netTotal = round2(grossTotal - refundCr);
      const unitNet = round2(netTotal / qtyBase);
      await db.query(
        `UPDATE inventory_movements
         SET unit_cost = $2,
             total_cost = $3,
             currency = 'CRC',
             fx_rate = NULL,
             unit_cost_usd = NULL,
             total_cost_usd = NULL,
             out_source_layer_id = $4,
             out_gross_total_crc = $5,
             out_refund_crc = $6,
             updated_at = NOW()
         WHERE id = $1`,
        [movementId, unitNet, netTotal, sourceLayerId, grossTotal, refundCr]
      );
    }

    const row = await getMovementById({ db, id: movementId, clientId });
    await db.query('COMMIT');
    return row;
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}

async function createAdjustment({ clientId, userId, payload, actorRole }) {
  const actorRoleNorm = String(actorRole || 'admin').trim().toLowerCase();
  if (actorRoleNorm === 'operario') {
    const err = new Error('Solo el administrador puede registrar ajustes de inventario.');
    err.status = 403;
    throw err;
  }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const itemId = normalizeText(payload?.item_id);
    if (!itemId) {
      const err = new Error('item_id es obligatorio.');
      err.status = 400;
      throw err;
    }
    const item = await getActiveItemById({ db, itemId, clientId });
    const movDate = normalizeDate(payload?.mov_date, { required: true });
    const countedQty = resolveQtyBase({
      qty: payload?.counted_qty,
      packCount: payload?.pack_count,
      packSize: payload?.pack_size,
      packUnit: payload?.pack_unit,
      itemUnit: item.unit,
    });
    const notes = normalizeText(payload?.notes);
    const currentStock = await getCurrentStock({ db, itemId, clientId });
    const diff = round2(countedQty - currentStock);
    if (Math.abs(diff) < 0.0005) {
      await db.query('ROLLBACK');
      return { no_change: true, item_id: itemId, counted_qty: countedQty, current_stock: currentStock };
    }

    const isUp = diff > 0;
    const qty = Math.abs(diff);

    let insertUnitCost = null;
    let insertTotalCost = null;
    let adjustLayerId = null;
    if (isUp) {
      const oldest = await getOldestActiveLayerForItem({ db, clientId, itemId });
      if (!oldest) {
        const err = new Error(
          'No hay capas de inventario activas para este insumo. Registre una entrada antes de un ajuste al alza.'
        );
        err.status = 409;
        throw err;
      }
      const uc = Number(oldest.unit_cost);
      insertTotalCost = round2(qty * uc);
      insertUnitCost = round2(insertTotalCost / qty);
      adjustLayerId = oldest.id;
    }

    const movementRes = await db.query(
      `INSERT INTO inventory_movements (
         item_id, mov_date, movement, qty, unit_cost, total_cost, notes, pack_label, pack_count, pack_size, pack_unit, pack_cost,
         currency, fx_rate, unit_cost_usd, total_cost_usd, adjust_layer_id, client_id, created_by_user_id, updated_by_user_id
       )
       VALUES ($1, $2, 'adjust'::movement_type, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       RETURNING id`,
      [
        itemId,
        movDate,
        qty,
        isUp ? insertUnitCost : null,
        isUp ? insertTotalCost : null,
        notes,
        normalizeText(payload?.pack_label),
        normalizeNonNegativeOptional(payload?.pack_count, 'pack_count'),
        normalizeNonNegativeOptional(payload?.pack_size, 'pack_size'),
        normalizeText(payload?.pack_unit),
        null,
        'CRC',
        null,
        null,
        null,
        isUp ? adjustLayerId : null,
        clientId,
        userId,
        userId,
      ]
    );
    const movementId = movementRes.rows[0].id;

    if (isUp) {
      await db.query(
        `UPDATE inventory_layers
         SET qty_in = qty_in + $2::numeric,
             qty_remaining = qty_remaining + $2::numeric,
             updated_at = NOW()
         WHERE id = $1
           AND client_id = $3`,
        [adjustLayerId, qty, clientId]
      );
    } else {
      const consumed = await consumeFifoLayers({
        db,
        clientId,
        itemId,
        qtyToConsume: qty,
        movementId,
      });
      await db.query(
        `UPDATE inventory_movements
         SET unit_cost = $2,
             total_cost = $3,
             currency = 'CRC',
             fx_rate = NULL,
             unit_cost_usd = NULL,
             total_cost_usd = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [movementId, consumed.unitCost, consumed.totalCost]
      );
    }

    const out = await getMovementById({ db, id: movementId, clientId });
    await db.query('COMMIT');
    return out;
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}

async function updateMovement({ clientId, userId, id, payload, actorRole }) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const current = await getMovementById({ db, id, clientId });
    if (!current) {
      await db.query('ROLLBACK');
      return null;
    }
    const actorRoleNorm = String(actorRole || 'admin').trim().toLowerCase();
    if (actorRoleNorm === 'operario' && current.movement !== 'in') {
      const err = new Error('Solo el administrador puede editar salidas o ajustes de inventario.');
      err.status = 403;
      throw err;
    }
    if (current.movement === 'in') {
      const layerRes = await db.query(
        `SELECT qty_in, qty_remaining FROM inventory_layers WHERE movement_in_id = $1 AND client_id = $2 LIMIT 1`,
        [id, clientId]
      );
      const ly = layerRes.rows[0];
      if (ly && Number(ly.qty_remaining) < Number(ly.qty_in)) {
        const err = new Error(
          'No se puede editar este movimiento de entrada porque el stock asociado ya fue consumido.'
        );
        err.status = 409;
        throw err;
      }
    }
    const movDate =
      payload.mov_date !== undefined
        ? normalizeDate(payload.mov_date, { required: true })
        : String(current.mov_date).slice(0, 10);
    const notes = payload.notes !== undefined ? normalizeText(payload.notes) : current.notes;
    if (current.movement === 'out' && payload.notes !== undefined) {
      if (!notes || String(notes).trim().length < OUT_NOTES_MIN_LEN) {
        const err = new Error(
          `En salidas las observaciones son obligatorias (mínimo ${OUT_NOTES_MIN_LEN} caracteres).`
        );
        err.status = 400;
        throw err;
      }
    }
    await db.query(
      `UPDATE inventory_movements
       SET mov_date = $2,
           notes = $3,
           updated_by_user_id = $4,
           updated_at = NOW()
       WHERE id = $1
         AND client_id = $5`,
      [id, movDate, notes, userId, clientId]
    );

    // Keep layer dates aligned when movement owns a layer (in o ajuste al alza con capa propia).
    await db.query(
      `UPDATE inventory_layers
       SET layer_date = $2,
           updated_at = NOW()
       WHERE movement_in_id = $1
         AND client_id = $3`,
      [id, movDate, clientId]
    );
    if (current.adjust_layer_id) {
      await db.query(
        `UPDATE inventory_layers
         SET layer_date = $2,
             updated_at = NOW()
         WHERE id = $1
           AND client_id = $3`,
        [current.adjust_layer_id, movDate, clientId]
      );
    }
    const row = await getMovementById({ db, id, clientId });
    await db.query('COMMIT');
    return row;
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}

async function setMovementActive({ clientId, userId, id, isActive, actorRole }) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const current = await getMovementById({ db, id, clientId });
    if (!current) {
      await db.query('ROLLBACK');
      return null;
    }
    const actorRoleNorm = String(actorRole || 'admin').trim().toLowerCase();
    if (actorRoleNorm === 'operario' && current.movement !== 'in') {
      const err = new Error('Solo el administrador puede activar o inactivar salidas y ajustes de inventario.');
      err.status = 403;
      throw err;
    }
    if (Boolean(current.is_active) === Boolean(isActive)) {
      await db.query('ROLLBACK');
      return current;
    }

    const layerRes = await db.query(
      `SELECT id, qty_in, qty_remaining, is_active
       FROM inventory_layers
       WHERE movement_in_id = $1
         AND client_id = $2
       LIMIT 1`,
      [id, clientId]
    );
    const movementLayersRes = await db.query(
      `SELECT ml.id
       FROM inventory_movement_layers ml
       INNER JOIN inventory_movements m ON m.id = ml.movement_id AND m.client_id = $2
       WHERE ml.movement_id = $1
       LIMIT 1`,
      [id, clientId]
    );
    const hasInboundLayer = !!layerRes.rows[0];
    const hasConsumption = !!movementLayersRes.rows[0];

    if (!isActive) {
      if (hasConsumption) {
        await revertFifoConsumption({ db, movementId: id, clientId });
      } else if (hasInboundLayer) {
        const layer = layerRes.rows[0];
        if (Number(layer.qty_remaining) < Number(layer.qty_in)) {
          const err = new Error('No se puede inactivar porque la capa ya fue consumida.');
          err.status = 409;
          throw err;
        }
        await db.query(
          `UPDATE inventory_layers
           SET is_active = false,
               updated_at = NOW()
           WHERE id = $1
             AND client_id = $2`,
          [layer.id, clientId]
        );
      } else if (current.movement === 'adjust' && current.adjust_layer_id) {
        const qadj = Number(current.qty);
        const rev = await db.query(
          `UPDATE inventory_layers
           SET qty_in = qty_in - $2::numeric,
               qty_remaining = qty_remaining - $2::numeric,
               updated_at = NOW()
           WHERE id = $1
             AND client_id = $3
             AND qty_remaining >= $2::numeric
           RETURNING id`,
          [current.adjust_layer_id, qadj, clientId]
        );
        if (!rev.rows[0]) {
          const err = new Error(
            'No se puede inactivar este ajuste al alza: el saldo en la capa origen ya no permite la reversión.'
          );
          err.status = 409;
          throw err;
        }
      }
    } else {
      if (hasConsumption) {
        await db.query(
          `DELETE FROM inventory_movement_layers ml
           USING inventory_movements m
           WHERE ml.movement_id = m.id
             AND m.id = $1
             AND m.client_id = $2`,
          [id, clientId]
        );
        const qtyMov = Number(current.qty);
        if (current.movement === 'out') {
          let grossTotal;
          if (current.out_source_layer_id) {
            const spec = await consumeSpecificLayer({
              db,
              clientId,
              itemId: current.item_id,
              layerId: current.out_source_layer_id,
              qtyToConsume: qtyMov,
              movementId: id,
            });
            grossTotal = spec.grossTotal;
          } else {
            const fifo = await consumeFifoLayers({
              db,
              clientId,
              itemId: current.item_id,
              qtyToConsume: qtyMov,
              movementId: id,
            });
            grossTotal = fifo.totalCost;
          }
          const refundCr = round2(Number(current.out_refund_crc || 0));
          const netTotal = round2(grossTotal - refundCr);
          const unitNet = round2(netTotal / qtyMov);
          await db.query(
            `UPDATE inventory_movements
             SET unit_cost = $2,
                 total_cost = $3,
                 out_gross_total_crc = $4,
                 updated_at = NOW()
             WHERE id = $1`,
            [id, unitNet, netTotal, grossTotal]
          );
        } else {
          const fifo = await consumeFifoLayers({
            db,
            clientId,
            itemId: current.item_id,
            qtyToConsume: qtyMov,
            movementId: id,
          });
          await db.query(
            `UPDATE inventory_movements
             SET unit_cost = $2,
                 total_cost = $3,
                 currency = 'CRC',
                 fx_rate = NULL,
                 unit_cost_usd = NULL,
                 total_cost_usd = NULL,
                 updated_at = NOW()
             WHERE id = $1`,
            [id, fifo.unitCost, fifo.totalCost]
          );
        }
      } else if (hasInboundLayer) {
        const layer = layerRes.rows[0];
        await db.query(
          `UPDATE inventory_layers
           SET is_active = true,
               qty_remaining = qty_in,
               updated_at = NOW()
           WHERE id = $1
             AND client_id = $2`,
          [layer.id, clientId]
        );
      } else if (current.movement === 'adjust' && current.adjust_layer_id) {
        await db.query(
          `UPDATE inventory_layers
           SET qty_in = qty_in + $2::numeric,
               qty_remaining = qty_remaining + $2::numeric,
               updated_at = NOW()
           WHERE id = $1
             AND client_id = $3`,
          [current.adjust_layer_id, Number(current.qty), clientId]
        );
      }
    }

    await db.query(
      `UPDATE inventory_movements
       SET is_active = $2,
           updated_by_user_id = $3,
           updated_at = NOW()
       WHERE id = $1
         AND client_id = $4`,
      [id, !!isActive, userId, clientId]
    );
    const row = await getMovementById({ db, id, clientId });
    await db.query('COMMIT');
    return row;
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}

async function getStock({ clientId, itemId = null, onlyWithStock = true }) {
  const clauses = ['i.client_id = $1'];
  const values = [clientId];
  let idx = 2;
  if (itemId) {
    clauses.push(`i.id = $${idx++}`);
    values.push(itemId);
  }

  const havingClause =
    !itemId && onlyWithStock
      ? 'HAVING COALESCE(SUM(CASE WHEN l.is_active = true THEN l.qty_remaining ELSE 0 END), 0) > 0'
      : '';

  const res = await pool.query(
    `SELECT i.id AS item_id,
            i.name AS item_name,
            i.unit,
            i.is_active AS item_is_active,
            c.name AS category_name,
            b.name AS brand_name,
            COALESCE(SUM(CASE WHEN l.is_active = true THEN l.qty_remaining ELSE 0 END), 0)::numeric(14,3) AS stock_qty,
            COALESCE(SUM(CASE WHEN l.is_active = true THEN l.qty_remaining * l.unit_cost ELSE 0 END), 0)::numeric(14,2) AS stock_value_crc
     FROM inventory_items i
     LEFT JOIN inventory_categories c ON c.id = i.category_id
     LEFT JOIN inventory_brands b ON b.id = i.brand_id AND b.client_id = i.client_id
     LEFT JOIN inventory_layers l ON l.item_id = i.id AND l.client_id = i.client_id
     WHERE ${clauses.join(' AND ')}
     GROUP BY i.id, c.name, b.name
     ${havingClause}
     ORDER BY i.name ASC`,
    values
  );
  return res.rows;
}

async function getItemLayers({ clientId, itemId, onlyAvailable = false }) {
  const item = await getActiveItemById({ db: pool, itemId, clientId });
  const availClause = onlyAvailable ? 'AND l.is_active = true AND l.qty_remaining > 0' : '';
  const layers = await pool.query(
    `SELECT l.id, l.layer_date, l.qty_in, l.qty_remaining, l.unit_cost, l.is_active, l.created_at,
            m.id AS movement_in_id, m.mov_date, m.movement,
            m.pack_label AS inbound_pack_label,
            m.pack_count AS inbound_pack_count,
            m.pack_size AS inbound_pack_size,
            m.pack_unit AS inbound_pack_unit,
            m.pack_cost AS inbound_pack_cost,
            m.currency AS inbound_currency,
            m.fx_rate AS inbound_fx_rate,
            m.unit_cost AS inbound_unit_cost_crc,
            m.total_cost AS inbound_total_cost_crc,
            m.unit_cost_usd AS inbound_unit_cost_usd,
            m.total_cost_usd AS inbound_total_cost_usd
     FROM inventory_layers l
     JOIN inventory_movements m ON m.id = l.movement_in_id AND m.client_id = l.client_id
     WHERE l.client_id = $1
       AND l.item_id = $2
       ${availClause}
     ORDER BY l.layer_date ASC, l.created_at ASC`,
    [clientId, itemId]
  );
  return { item, layers: layers.rows };
}

async function getMovementsMeta({ clientId }) {
  const res = await pool.query(
    `SELECT id, name, unit
     FROM inventory_items
     WHERE client_id = $1
       AND is_active = true
     ORDER BY name ASC`,
    [clientId]
  );
  return { items: res.rows, movementTypes: ['in', 'out', 'adjust'] };
}

module.exports = {
  listMovements,
  getMovementById: ({ id, clientId }) => getMovementById({ db: pool, id, clientId }),
  getMovementLayers,
  createMovement,
  createAdjustment,
  updateMovement,
  setMovementActive,
  getStock,
  getItemLayers,
  getMovementsMeta,
};

