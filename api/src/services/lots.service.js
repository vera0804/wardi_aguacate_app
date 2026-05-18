const { pool } = require('../db');
const { assertLotCapacityOnFarm } = require('./client-plan-limits.service');

function normalizeUuid(value) {
  if (value === undefined) return undefined;
  const v = String(value || '').trim();
  return v || null;
}

function normalizeName(value) {
  const cleanName = String(value || '').trim();
  if (!cleanName) {
    const err = new Error('El nombre del lote es obligatorio.');
    err.status = 400;
    throw err;
  }
  return cleanName;
}

function normalizeArea(value, { required = false } = {}) {
  if (value === undefined && !required) return undefined;
  if (value === null || value === '') {
    if (required) {
      const err = new Error('El área (ha) es obligatoria.');
      err.status = 400;
      throw err;
    }
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    const err = new Error('El área (ha) debe ser un número mayor que 0.');
    err.status = 400;
    throw err;
  }
  return n;
}

function normalizePlantCount(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return 0;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    const err = new Error('plant_count debe ser un entero mayor o igual a 0.');
    err.status = 400;
    throw err;
  }
  return n;
}

function normalizeVarietyIds(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    const err = new Error('variety_ids debe ser un arreglo.');
    err.status = 400;
    throw err;
  }
  const unique = [...new Set(value.map((id) => String(id || '').trim()).filter(Boolean))];
  return unique;
}

async function assertUniqueLotNameByFarm({ db, farmId, clientId, name, excludeLotId = null }) {
  const cx = db || pool;
  const res = await cx.query(
    `SELECT id
     FROM lots
     WHERE farm_id = $1
       AND client_id = $2
       AND lower(trim(name)) = lower(trim($3))
       AND ($4::uuid IS NULL OR id <> $4::uuid)
     LIMIT 1`,
    [farmId, clientId, name, excludeLotId]
  );
  if (res.rows[0]) {
    const err = new Error('Ya existe un lote con ese nombre en la finca seleccionada.');
    err.status = 409;
    throw err;
  }
}

async function assertValidVarieties(varietyIds) {
  if (!varietyIds || varietyIds.length === 0) return;
  const res = await pool.query(
    `SELECT id
     FROM avocado_varieties
     WHERE id = ANY($1::uuid[])
       AND is_active = true`,
    [varietyIds]
  );
  if (res.rows.length !== varietyIds.length) {
    const err = new Error('Una o más variedades no son válidas o están inactivas.');
    err.status = 400;
    throw err;
  }
}

async function replaceLotVarieties({ db, lotId, userId, varietyIds }) {
  if (varietyIds === undefined) return;
  await db.query(`DELETE FROM lot_avocado_varieties WHERE lot_id = $1`, [lotId]);
  if (!varietyIds.length) return;
  await db.query(
    `INSERT INTO lot_avocado_varieties (lot_id, avocado_variety_id, created_by_user_id, updated_by_user_id)
     SELECT $1, v.id, $2, $2
     FROM unnest($3::uuid[]) AS v(id)`,
    [lotId, userId, varietyIds]
  );
}

async function getVarietiesByLotIds(lotIds) {
  if (!lotIds.length) return new Map();
  const res = await pool.query(
    `SELECT lcv.lot_id,
            cv.id,
            COALESCE(NULLIF(trim(cv.display_name), ''), cv.name) AS name
     FROM lot_avocado_varieties lcv
     JOIN avocado_varieties cv ON cv.id = lcv.avocado_variety_id
     WHERE lcv.lot_id = ANY($1::uuid[])
       AND lcv.is_active = true
     ORDER BY name ASC`,
    [lotIds]
  );
  const map = new Map();
  for (const row of res.rows) {
    if (!map.has(row.lot_id)) map.set(row.lot_id, []);
    map.get(row.lot_id).push({ id: row.id, name: row.name });
  }
  return map;
}

async function listLots({ clientId, farmId, includeInactive = false }) {
  const res = await pool.query(
    `SELECT l.id, l.farm_id, f.name AS farm_name, l.name, l.area_ha, l.plant_count,
            l.is_active, l.deactivated_at, l.created_at, l.updated_at
     FROM lots l
     JOIN farms f ON f.id = l.farm_id
     WHERE l.client_id = $1
       AND ($2::uuid IS NULL OR l.farm_id = $2::uuid)
       AND ($3::boolean = true OR l.is_active = true)
     ORDER BY l.is_active DESC, f.name ASC, l.name ASC`,
    [clientId, farmId || null, includeInactive]
  );
  const lots = res.rows;
  const byLot = await getVarietiesByLotIds(lots.map((l) => l.id));
  return lots.map((lot) => ({
    ...lot,
    varieties: byLot.get(lot.id) || [],
    variety_ids: (byLot.get(lot.id) || []).map((v) => v.id),
  }));
}

async function getLotById({ lotId, clientId }) {
  const res = await pool.query(
    `SELECT l.id, l.farm_id, f.name AS farm_name, l.name, l.area_ha, l.plant_count,
            l.is_active, l.deactivated_at, l.created_at, l.updated_at
     FROM lots l
     JOIN farms f ON f.id = l.farm_id
     WHERE l.id = $1
       AND l.client_id = $2`,
    [lotId, clientId]
  );
  const lot = res.rows[0] || null;
  if (!lot) return null;
  const byLot = await getVarietiesByLotIds([lot.id]);
  const varieties = byLot.get(lot.id) || [];
  return {
    ...lot,
    varieties,
    variety_ids: varieties.map((v) => v.id),
  };
}

async function createLot({ clientId, userId, farmId, name, areaHa, plantCount, varietyIds }) {
  const cleanFarmId = normalizeUuid(farmId);
  if (!cleanFarmId) {
    const err = new Error('farm_id es obligatorio.');
    err.status = 400;
    throw err;
  }
  const cleanName = normalizeName(name);
  const cleanArea = normalizeArea(areaHa);
  const cleanPlantCount = normalizePlantCount(plantCount);
  const cleanVarietyIds = normalizeVarietyIds(varietyIds) || [];

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const farmRes = await db.query(
      `SELECT id
       FROM farms
       WHERE id = $1
         AND client_id = $2
         AND is_active = true
       FOR UPDATE`,
      [cleanFarmId, clientId]
    );
    if (!farmRes.rows[0]) {
      const err = new Error('La finca seleccionada no existe o está inactiva.');
      err.status = 409;
      throw err;
    }
    await assertUniqueLotNameByFarm({ db, farmId: cleanFarmId, clientId, name: cleanName });
    await assertValidVarieties(cleanVarietyIds);
    await assertLotCapacityOnFarm({ db, clientId, farmId: cleanFarmId, excludeLotId: null });

    const res = await db.query(
      `INSERT INTO lots (
         farm_id, name, area_ha, plant_count, client_id, created_by_user_id, updated_by_user_id
       )
       VALUES ($1, $2, $3, COALESCE($4, 0), $5, $6, $6)
       RETURNING id`,
      [cleanFarmId, cleanName, cleanArea, cleanPlantCount, clientId, userId]
    );
    const lotId = res.rows[0].id;
    await replaceLotVarieties({ db, lotId, userId, varietyIds: cleanVarietyIds });
    await db.query('COMMIT');
    return getLotById({ lotId, clientId });
  } catch (e) {
    await db.query('ROLLBACK');
    if (e.code === '23505') {
      const err = new Error('Ya existe un lote con ese nombre en la finca seleccionada.');
      err.status = 409;
      throw err;
    }
    throw e;
  } finally {
    db.release();
  }
}

async function updateLot({ lotId, clientId, userId, farmId, name, areaHa, plantCount, varietyIds }) {
  const current = await getLotById({ lotId, clientId });
  if (!current) return null;

  const nextFarmId = farmId !== undefined ? normalizeUuid(farmId) : current.farm_id;
  if (!nextFarmId) {
    const err = new Error('farm_id es obligatorio.');
    err.status = 400;
    throw err;
  }
  const nextName = name !== undefined ? normalizeName(name) : current.name;
  const nextArea = areaHa !== undefined ? normalizeArea(areaHa) : undefined;
  const nextPlantCount = plantCount !== undefined ? normalizePlantCount(plantCount) : undefined;
  const nextVarietyIds = normalizeVarietyIds(varietyIds);

  const fields = [];
  const values = [];
  let idx = 1;

  if (farmId !== undefined) {
    fields.push(`farm_id = $${idx++}`);
    values.push(nextFarmId);
  }
  if (name !== undefined) {
    fields.push(`name = $${idx++}`);
    values.push(nextName);
  }
  if (areaHa !== undefined) {
    fields.push(`area_ha = $${idx++}`);
    values.push(nextArea);
  }
  if (plantCount !== undefined) {
    fields.push(`plant_count = $${idx++}`);
    values.push(nextPlantCount);
  }

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const farmRes = await db.query(
      `SELECT id
       FROM farms
       WHERE id = $1
         AND client_id = $2
         AND is_active = true
       FOR UPDATE`,
      [nextFarmId, clientId]
    );
    if (!farmRes.rows[0]) {
      const err = new Error('La finca seleccionada no existe o está inactiva.');
      err.status = 409;
      throw err;
    }
    await assertUniqueLotNameByFarm({
      db,
      farmId: nextFarmId,
      clientId,
      name: nextName,
      excludeLotId: lotId,
    });
    if (nextVarietyIds !== undefined) {
      await assertValidVarieties(nextVarietyIds);
    }
    if (current.is_active && String(nextFarmId) !== String(current.farm_id)) {
      await assertLotCapacityOnFarm({ db, clientId, farmId: nextFarmId, excludeLotId: lotId });
    }
    if (fields.length > 0) {
      fields.push(`updated_by_user_id = $${idx++}`);
      values.push(userId);
      fields.push(`updated_at = NOW()`);
      values.push(lotId);
      values.push(clientId);
      await db.query(
        `UPDATE lots
         SET ${fields.join(', ')}
         WHERE id = $${idx++}
           AND client_id = $${idx}`,
        values
      );
    }

    await replaceLotVarieties({ db, lotId, userId, varietyIds: nextVarietyIds });
    await db.query('COMMIT');
    return getLotById({ lotId, clientId });
  } catch (e) {
    await db.query('ROLLBACK');
    if (e.code === '23505') {
      const err = new Error('Ya existe un lote con ese nombre en la finca seleccionada.');
      err.status = 409;
      throw err;
    }
    throw e;
  } finally {
    db.release();
  }
}

async function setLotActive({ lotId, clientId, userId, isActive }) {
  const want = !!isActive;
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const lotRes = await db.query(
      `SELECT l.id, l.farm_id, l.is_active
       FROM lots l
       WHERE l.id = $1
         AND l.client_id = $2
       FOR UPDATE`,
      [lotId, clientId]
    );
    const lotRow = lotRes.rows[0];
    if (!lotRow) {
      await db.query('ROLLBACK');
      return null;
    }

    if (want) {
      const farmRes = await db.query(
        `SELECT id
         FROM farms
         WHERE id = $1
           AND client_id = $2
           AND is_active = true
         FOR UPDATE`,
        [lotRow.farm_id, clientId]
      );
      if (!farmRes.rows[0]) {
        const err = new Error('No se puede activar el lote porque la finca está inactiva.');
        err.status = 409;
        throw err;
      }
      await assertLotCapacityOnFarm({
        db,
        clientId,
        farmId: lotRow.farm_id,
        excludeLotId: lotId,
      });
    }

    const res = await db.query(
      `UPDATE lots
       SET is_active = $3,
           deactivated_at = CASE WHEN $3::boolean THEN NULL ELSE NOW() END,
           updated_by_user_id = $4,
           updated_at = NOW()
       WHERE id = $1
         AND client_id = $2
       RETURNING id`,
      [lotId, clientId, want, userId]
    );
    if (!res.rows[0]) {
      await db.query('ROLLBACK');
      return null;
    }
    await db.query('COMMIT');
    return getLotById({ lotId, clientId });
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}

async function listActiveFarmsForLots({ clientId }) {
  const res = await pool.query(
    `SELECT id, name
     FROM farms
     WHERE client_id = $1
       AND is_active = true
     ORDER BY name ASC`,
    [clientId]
  );
  return res.rows;
}

async function listActiveVarieties() {
  const res = await pool.query(
    `SELECT id, COALESCE(NULLIF(trim(display_name), ''), name) AS name
     FROM avocado_varieties
     WHERE is_active = true
     ORDER BY name ASC`
  );
  return res.rows;
}

module.exports = {
  listLots,
  getLotById,
  createLot,
  updateLot,
  setLotActive,
  listActiveFarmsForLots,
  listActiveVarieties,
};

