const { pool } = require('../db');
const { getClientPlanLimits } = require('./client-plan-limits.service');

const VALID_LABOR_MODES = new Set(['area', 'manual']);
const DEFAULT_LABOR_MODE = 'manual';

const FARM_SELECT = `
  SELECT f.id, f.name, f.area_ha, f.labor_allocation_mode,
         f.province_id, f.canton_id, f.district_id, f.community,
         p.name AS province_name,
         c.name AS canton_name,
         d.name AS district_name,
         f.is_active, f.deactivated_at, f.created_at, f.updated_at
  FROM farms f
  LEFT JOIN provinces p ON p.id = f.province_id
  LEFT JOIN cantons c ON c.id = f.canton_id
  LEFT JOIN districts d ON d.id = f.district_id`;

function normalizeNullableText(value) {
  if (value == null) return null;
  const v = String(value).trim();
  return v ? v : null;
}

function normalizeOptionalId(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    const err = new Error('Identificador geográfico inválido.');
    err.status = 400;
    throw err;
  }
  return n;
}

function formatFarmLocationDisplay({ provinceName, cantonName, districtName, community }) {
  const parts = [provinceName, cantonName, districtName, community].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function mapFarmRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    area_ha: row.area_ha,
    labor_allocation_mode: row.labor_allocation_mode,
    province_id: row.province_id,
    canton_id: row.canton_id,
    district_id: row.district_id,
    community: row.community,
    province_name: row.province_name,
    canton_name: row.canton_name,
    district_name: row.district_name,
    location_display: formatFarmLocationDisplay({
      provinceName: row.province_name,
      cantonName: row.canton_name,
      districtName: row.district_name,
      community: row.community,
    }),
    is_active: row.is_active,
    deactivated_at: row.deactivated_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeArea(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    const err = new Error('El área (ha) debe ser un número mayor o igual a 0.');
    err.status = 400;
    throw err;
  }
  return n;
}

function normalizeLaborMode(value, { required = false } = {}) {
  if (value === undefined && !required) return undefined;
  const v = String(value || '').trim().toLowerCase();
  if (!VALID_LABOR_MODES.has(v)) {
    const err = new Error('labor_allocation_mode debe ser "area" o "manual".');
    err.status = 400;
    throw err;
  }
  return v;
}

/**
 * Valida y normaliza provincia / cantón / distrito (jerarquía CR).
 * @param {{ provinceId?: *, cantonId?: *, districtId?: *, community?: *, requireProvince?: boolean }} opts
 */
async function resolveFarmGeo({ provinceId, cantonId, districtId, community, requireProvince = false }) {
  const hasGeoInput =
    provinceId !== undefined ||
    cantonId !== undefined ||
    districtId !== undefined ||
    community !== undefined;

  if (!hasGeoInput) {
    return {
      provinceId: undefined,
      cantonId: undefined,
      districtId: undefined,
      community: undefined,
    };
  }

  let pid =
    provinceId === undefined ? undefined : normalizeOptionalId(provinceId);
  let cid = cantonId === undefined ? undefined : normalizeOptionalId(cantonId);
  let did = districtId === undefined ? undefined : normalizeOptionalId(districtId);
  const comm = community === undefined ? undefined : normalizeNullableText(community);

  if (requireProvince && (pid === undefined || pid === null)) {
    const err = new Error('La provincia es obligatoria.');
    err.status = 400;
    throw err;
  }

  if (pid != null) {
    const pRes = await pool.query(`SELECT id FROM provinces WHERE id = $1`, [pid]);
    if (!pRes.rows[0]) {
      const err = new Error('Provincia no encontrada.');
      err.status = 400;
      throw err;
    }
  }

  if (cid != null) {
    const cRes = await pool.query(
      `SELECT id, province_id FROM cantons WHERE id = $1`,
      [cid]
    );
    const canton = cRes.rows[0];
    if (!canton) {
      const err = new Error('Cantón no encontrado.');
      err.status = 400;
      throw err;
    }
    if (pid != null && canton.province_id !== pid) {
      const err = new Error('El cantón no pertenece a la provincia seleccionada.');
      err.status = 400;
      throw err;
    }
    if (pid == null) pid = canton.province_id;
  } else if (did != null) {
    const err = new Error('Debe seleccionar cantón para elegir un distrito.');
    err.status = 400;
    throw err;
  }

  if (did != null) {
    const dRes = await pool.query(
      `SELECT id, canton_id FROM districts WHERE id = $1`,
      [did]
    );
    const district = dRes.rows[0];
    if (!district) {
      const err = new Error('Distrito no encontrado.');
      err.status = 400;
      throw err;
    }
    if (cid != null && district.canton_id !== cid) {
      const err = new Error('El distrito no pertenece al cantón seleccionado.');
      err.status = 400;
      throw err;
    }
    if (cid == null) {
      const cRes = await pool.query(
        `SELECT id, province_id FROM cantons WHERE id = $1`,
        [district.canton_id]
      );
      cid = cRes.rows[0]?.id ?? null;
      if (pid == null && cRes.rows[0]) pid = cRes.rows[0].province_id;
    }
  }

  return {
    provinceId: pid,
    cantonId: cid,
    districtId: did,
    community: comm,
  };
}

async function getClientFarmLimit(clientId) {
  return getClientPlanLimits(clientId);
}

async function countActiveFarms(clientId) {
  const res = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM farms
     WHERE client_id = $1 AND is_active = true`,
    [clientId]
  );
  return res.rows[0]?.total || 0;
}

async function assertFarmLimitForActivation(clientId) {
  const planRow = await getClientFarmLimit(clientId);
  if (!planRow) {
    const err = new Error('Cliente no encontrado.');
    err.status = 404;
    throw err;
  }
  if (planRow.plan_id == null) {
    const err = new Error('El cliente no tiene un plan asignado.');
    err.status = 409;
    throw err;
  }
  if (planRow.max_farms == null) {
    return;
  }
  const activeFarms = await countActiveFarms(clientId);
  if (activeFarms >= Number(planRow.max_farms)) {
    const err = new Error('Has alcanzado el máximo de fincas permitidas por tu plan.');
    err.status = 409;
    throw err;
  }
}

async function listFarms({ clientId, includeInactive = false }) {
  const res = await pool.query(
    `${FARM_SELECT}
     WHERE f.client_id = $1
       AND ($2::boolean = true OR f.is_active = true)
     ORDER BY f.is_active DESC, f.name ASC`,
    [clientId, includeInactive]
  );
  return res.rows.map(mapFarmRow);
}

async function createFarm({
  clientId,
  userId,
  name,
  provinceId,
  cantonId,
  districtId,
  community,
  areaHa,
  laborAllocationMode,
}) {
  const cleanName = String(name || '').trim();
  if (!cleanName) {
    const err = new Error('El nombre de la finca es obligatorio.');
    err.status = 400;
    throw err;
  }
  const cleanArea = normalizeArea(areaHa);
  const cleanMode =
    laborAllocationMode === undefined
      ? DEFAULT_LABOR_MODE
      : normalizeLaborMode(laborAllocationMode, { required: true });

  const geo = await resolveFarmGeo({
    provinceId,
    cantonId,
    districtId,
    community,
    requireProvince: true,
  });

  await assertFarmLimitForActivation(clientId);

  const res = await pool.query(
    `INSERT INTO farms (
        name, province_id, canton_id, district_id, community,
        area_ha, labor_allocation_mode, client_id, created_by_user_id, updated_by_user_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
     RETURNING id`,
    [
      cleanName,
      geo.provinceId,
      geo.cantonId,
      geo.districtId,
      geo.community,
      cleanArea,
      cleanMode,
      clientId,
      userId,
    ]
  );
  const farmId = res.rows[0]?.id;
  const loaded = await pool.query(`${FARM_SELECT} WHERE f.id = $1 AND f.client_id = $2`, [
    farmId,
    clientId,
  ]);
  return mapFarmRow(loaded.rows[0]);
}

async function updateFarm({
  farmId,
  clientId,
  userId,
  name,
  provinceId,
  cantonId,
  districtId,
  community,
  areaHa,
  laborAllocationMode,
}) {
  const fields = [];
  const values = [];
  let idx = 1;

  if (name !== undefined) {
    const cleanName = String(name || '').trim();
    if (!cleanName) {
      const err = new Error('El nombre de la finca es obligatorio.');
      err.status = 400;
      throw err;
    }
    fields.push(`name = $${idx++}`);
    values.push(cleanName);
  }

  const geoTouched =
    provinceId !== undefined ||
    cantonId !== undefined ||
    districtId !== undefined ||
    community !== undefined;

  if (geoTouched) {
    const geo = await resolveFarmGeo({
      provinceId,
      cantonId,
      districtId,
      community,
      requireProvince: true,
    });
    fields.push(`province_id = $${idx++}`);
    values.push(geo.provinceId);
    fields.push(`canton_id = $${idx++}`);
    values.push(geo.cantonId);
    fields.push(`district_id = $${idx++}`);
    values.push(geo.districtId);
    fields.push(`community = $${idx++}`);
    values.push(geo.community);
  }

  if (areaHa !== undefined) {
    fields.push(`area_ha = $${idx++}`);
    values.push(normalizeArea(areaHa));
  }

  if (laborAllocationMode !== undefined) {
    fields.push(`labor_allocation_mode = $${idx++}`);
    values.push(normalizeLaborMode(laborAllocationMode, { required: true }));
  }

  if (!fields.length) {
    const err = new Error('No hay cambios para actualizar.');
    err.status = 400;
    throw err;
  }

  fields.push(`updated_by_user_id = $${idx++}`);
  values.push(userId);
  fields.push(`updated_at = NOW()`);

  values.push(farmId);
  values.push(clientId);

  const res = await pool.query(
    `UPDATE farms
     SET ${fields.join(', ')}
     WHERE id = $${idx++}
       AND client_id = $${idx}
     RETURNING id`,
    values
  );

  if (!res.rows[0]) return null;

  const loaded = await pool.query(`${FARM_SELECT} WHERE f.id = $1 AND f.client_id = $2`, [
    farmId,
    clientId,
  ]);
  return mapFarmRow(loaded.rows[0]);
}

async function inactivateFarm({ farmId, clientId, userId }) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');

    const farmRes = await db.query(
      `UPDATE farms
       SET is_active = false,
           deactivated_at = NOW(),
           updated_by_user_id = $3,
           updated_at = NOW()
       WHERE id = $1
         AND client_id = $2
         AND is_active = true
       RETURNING id`,
      [farmId, clientId, userId]
    );
    const farmIdRow = farmRes.rows[0]?.id || null;
    if (!farmIdRow) {
      await db.query('ROLLBACK');
      return null;
    }

    await db.query(
      `UPDATE lots
       SET is_active = false,
           deactivated_at = NOW(),
           updated_by_user_id = $3,
           updated_at = NOW()
       WHERE farm_id = $1
         AND client_id = $2
         AND is_active = true`,
      [farmId, clientId, userId]
    );

    await db.query('COMMIT');

    const loaded = await pool.query(`${FARM_SELECT} WHERE f.id = $1 AND f.client_id = $2`, [
      farmId,
      clientId,
    ]);
    return mapFarmRow(loaded.rows[0]);
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}

async function activateFarm({ farmId, clientId, userId }) {
  await assertFarmLimitForActivation(clientId);

  const res = await pool.query(
    `UPDATE farms
     SET is_active = true,
         deactivated_at = NULL,
         updated_by_user_id = $3,
         updated_at = NOW()
     WHERE id = $1
       AND client_id = $2
       AND is_active = false
     RETURNING id`,
    [farmId, clientId, userId]
  );
  if (!res.rows[0]) return null;

  const loaded = await pool.query(`${FARM_SELECT} WHERE f.id = $1 AND f.client_id = $2`, [
    farmId,
    clientId,
  ]);
  return mapFarmRow(loaded.rows[0]);
}

module.exports = {
  listFarms,
  createFarm,
  updateFarm,
  inactivateFarm,
  activateFarm,
  formatFarmLocationDisplay,
};
