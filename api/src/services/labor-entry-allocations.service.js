const { pool } = require('../db');

const ALLOCATION_TOLERANCE = 0.01;

function round3(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
}

function normalizeToHundred(rows) {
  if (!rows.length) return rows;
  const rounded = rows.map((r) => ({
    ...r,
    allocation_pct: round3(r.allocation_pct),
  }));
  const sum = rounded.reduce((acc, r) => acc + Number(r.allocation_pct), 0);
  const diff = round3(100 - sum);
  rounded[rounded.length - 1].allocation_pct = round3(
    Number(rounded[rounded.length - 1].allocation_pct) + diff
  );
  return rounded;
}

async function getActiveLotsByFarm({ db = pool, farmId, clientId }) {
  const res = await db.query(
    `SELECT id, area_ha
     FROM lots
     WHERE farm_id = $1
       AND client_id = $2
       AND is_active = true
     ORDER BY id ASC`,
    [farmId, clientId]
  );
  return res.rows;
}

async function computeAreaAllocations({ db = pool, farmId, clientId }) {
  const lots = await getActiveLotsByFarm({ db, farmId, clientId });
  if (!lots.length) {
    const err = new Error('La finca no tiene lotes activos para prorratear.');
    err.status = 409;
    throw err;
  }

  const totalArea = lots.reduce((acc, lot) => acc + Number(lot.area_ha || 0), 0);
  let allocations;

  if (totalArea > 0) {
    allocations = lots.map((lot) => ({
      lot_id: lot.id,
      allocation_pct: (Number(lot.area_ha || 0) / totalArea) * 100,
    }));
  } else {
    const equal = 100 / lots.length;
    allocations = lots.map((lot) => ({
      lot_id: lot.id,
      allocation_pct: equal,
    }));
  }

  return normalizeToHundred(allocations);
}

async function validateManualAllocations({ db = pool, farmId, clientId, allocations }) {
  if (!Array.isArray(allocations) || allocations.length === 0) {
    const err = new Error('Debes enviar allocations para prorrateo manual.');
    err.status = 400;
    throw err;
  }

  const normalized = allocations
    .map((a) => ({
      lot_id: String(a?.lot_id || '').trim(),
      allocation_pct: Number(a?.allocation_pct),
    }))
    .filter((a) => a.lot_id);

  if (!normalized.length) {
    const err = new Error('Allocations inválidas: no se encontraron lotes válidos.');
    err.status = 400;
    throw err;
  }

  const seen = new Set();
  for (const a of normalized) {
    if (seen.has(a.lot_id)) {
      const err = new Error('Allocations inválidas: hay lotes repetidos.');
      err.status = 400;
      throw err;
    }
    seen.add(a.lot_id);

    if (!Number.isFinite(a.allocation_pct) || a.allocation_pct < 0 || a.allocation_pct > 100) {
      const err = new Error('Cada allocation_pct debe estar entre 0 y 100.');
      err.status = 400;
      throw err;
    }
  }

  const lots = await getActiveLotsByFarm({ db, farmId, clientId });
  const activeLotIds = new Set(lots.map((l) => l.id));
  for (const a of normalized) {
    if (!activeLotIds.has(a.lot_id)) {
      const err = new Error('Todos los lotes del prorrateo deben pertenecer a la finca y estar activos.');
      err.status = 409;
      throw err;
    }
  }

  const sum = normalized.reduce((acc, a) => acc + Number(a.allocation_pct), 0);
  if (Math.abs(sum - 100) > ALLOCATION_TOLERANCE) {
    const err = new Error('La suma de allocations debe ser 100%.');
    err.status = 400;
    throw err;
  }

  return normalizeToHundred(normalized);
}

async function resolveFarmAllocations({ db = pool, farmId, clientId, laborAllocationMode, allocations }) {
  if (clientId == null || !String(clientId).trim()) {
    const err = new Error('clientId es obligatorio para prorrateo por finca.');
    err.status = 400;
    throw err;
  }
  if (laborAllocationMode === 'manual') {
    return validateManualAllocations({ db, farmId, clientId, allocations });
  }
  return computeAreaAllocations({ db, farmId, clientId });
}

async function replaceLaborEntryAllocations({ db, laborEntryId, clientId, allocations, totalAmount }) {
  await db.query(
    `DELETE FROM labor_entry_allocations lea
     WHERE lea.labor_entry_id = $1
       AND EXISTS (
         SELECT 1 FROM labor_entries le
         WHERE le.id = lea.labor_entry_id
           AND le.client_id = $2
       )`,
    [laborEntryId, clientId]
  );
  if (!allocations || !allocations.length) return;

  const total = Number(totalAmount || 0);
  let accumulated = 0;

  for (let i = 0; i < allocations.length; i += 1) {
    const a = allocations[i];
    let amount = round3((total * Number(a.allocation_pct)) / 100);
    if (i === allocations.length - 1) {
      amount = round3(total - accumulated);
    }
    accumulated += amount;

    await db.query(
      `INSERT INTO labor_entry_allocations (
         labor_entry_id, lot_id, allocation_pct, amount_allocated, is_active, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, true, NOW(), NOW())`,
      [laborEntryId, a.lot_id, Number(a.allocation_pct), amount]
    );
  }
}

module.exports = {
  resolveFarmAllocations,
  replaceLaborEntryAllocations,
};
