const { pool } = require('../db');

let activityStatusLabelsCache = null;

async function loadActivityStatusLabels() {
  if (activityStatusLabelsCache) return activityStatusLabelsCache;
  const res = await pool.query(
    `SELECT e.enumlabel AS label
     FROM pg_type t
     JOIN pg_enum e ON e.enumtypid = t.oid
     JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public' AND t.typname = 'activity_status'
     ORDER BY e.enumsortorder`
  );
  activityStatusLabelsCache = res.rows.map((r) => r.label);
  return activityStatusLabelsCache;
}

function userDisplayName(row) {
  if (!row) return null;
  return [row.first_name, row.last_name_1, row.last_name_2].filter(Boolean).join(' ').trim() || null;
}

function normalizeText(value) {
  if (value == null) return null;
  const v = String(value).trim();
  return v || null;
}

function normalizeDate(value, { required = false, field = 'activity_date' } = {}) {
  if (value === undefined && !required) return undefined;
  const v = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const err = new Error(`${field} debe ser una fecha YYYY-MM-DD.`);
    err.status = 400;
    throw err;
  }
  return v;
}

function assertStatus(value, allowed) {
  const v = String(value || '').trim().toLowerCase();
  if (!allowed.includes(v)) {
    const err = new Error(`Estado inválido. Valores permitidos: ${allowed.join(', ')}.`);
    err.status = 400;
    throw err;
  }
  return v;
}

const BASE_SELECT = `
  SELECT ca.id, ca.activity_date, ca.farm_id, ca.lot_id, ca.labor_type_id, ca.status,
         ca.notes, ca.created_at, ca.updated_at, ca.created_by_user_id, ca.updated_by_user_id,
         f.name AS farm_name,
         l.name AS lot_name,
         lt.name AS labor_type_name,
         cu.first_name AS created_by_first_name,
         cu.last_name_1 AS created_by_last_name_1,
         cu.last_name_2 AS created_by_last_name_2,
         uu.first_name AS updated_by_first_name,
         uu.last_name_1 AS updated_by_last_name_1,
         uu.last_name_2 AS updated_by_last_name_2
  FROM calendar_activities ca
  JOIN farms f ON f.id = ca.farm_id AND f.client_id = ca.client_id
  LEFT JOIN lots l ON l.id = ca.lot_id AND l.client_id = ca.client_id AND l.farm_id = ca.farm_id
  JOIN labor_types lt ON lt.id = ca.labor_type_id
  LEFT JOIN users cu ON cu.id = ca.created_by_user_id AND cu.client_id = ca.client_id
  LEFT JOIN users uu ON uu.id = ca.updated_by_user_id AND uu.client_id = ca.client_id
`;

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    activity_date: row.activity_date,
    farm_id: row.farm_id,
    lot_id: row.lot_id,
    labor_type_id: row.labor_type_id,
    status: row.status,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by_user_id: row.created_by_user_id,
    updated_by_user_id: row.updated_by_user_id,
    farm_name: row.farm_name,
    lot_name: row.lot_name,
    labor_type_name: row.labor_type_name,
    created_by_display_name: userDisplayName({
      first_name: row.created_by_first_name,
      last_name_1: row.created_by_last_name_1,
      last_name_2: row.created_by_last_name_2,
    }),
    updated_by_display_name: userDisplayName({
      first_name: row.updated_by_first_name,
      last_name_1: row.updated_by_last_name_1,
      last_name_2: row.updated_by_last_name_2,
    }),
  };
}

async function listCalendarActivities({
  clientId,
  farmId,
  fromDate,
  toDate,
  lotId,
  laborTypeId,
  status,
}) {
  const allowed = await loadActivityStatusLabels();
  const values = [clientId];
  const clauses = ['ca.client_id = $1'];

  if (!farmId) {
    const err = new Error('farm_id es obligatorio.');
    err.status = 400;
    throw err;
  }
  values.push(farmId);
  clauses.push(`ca.farm_id = $${values.length}`);

  await assertFarmBelongsToClient({ db: pool, farmId, clientId });

  const from = normalizeDate(fromDate, { required: true, field: 'from' });
  const to = normalizeDate(toDate, { required: true, field: 'to' });
  if (from > to) {
    const err = new Error('El rango from / to es inválido.');
    err.status = 400;
    throw err;
  }
  values.push(from);
  clauses.push(`(ca.activity_date AT TIME ZONE 'UTC')::date >= $${values.length}::date`);
  values.push(to);
  clauses.push(`(ca.activity_date AT TIME ZONE 'UTC')::date <= $${values.length}::date`);

  const lot = normalizeText(lotId);
  if (lot) {
    const lotOk = await pool.query(
      `SELECT 1 FROM lots WHERE id = $1 AND farm_id = $2 AND client_id = $3`,
      [lot, farmId, clientId]
    );
    if (!lotOk.rows[0]) {
      const err = new Error('El lote no pertenece a la finca indicada o a tu organización.');
      err.status = 400;
      throw err;
    }
    values.push(lot);
    clauses.push(`ca.lot_id = $${values.length}`);
  }

  const lt = normalizeText(laborTypeId);
  if (lt) {
    values.push(lt);
    clauses.push(`ca.labor_type_id = $${values.length}`);
  }

  const st = normalizeText(status);
  if (st) {
    assertStatus(st, allowed);
    values.push(st);
    clauses.push(`ca.status = $${values.length}`);
  }

  /**
   * Un `calendar_activity` con `status='completed'` normalmente se sincroniza desde `labor_entries`.
   * Si una labor se inactiva (`labor_entries.is_active=false`), no debe mostrarse en el cronograma.
   * Para evitar depender de columnas adicionales en `calendar_activities`, filtramos completadas
   * según exista al menos una labor activa que las sustente (misma fecha + tipo + finca/lote por scope).
   */
  clauses.push(
    `(ca.status <> 'completed' OR EXISTS (
      SELECT 1
      FROM labor_entries le
      LEFT JOIN lots l
        ON l.id = le.lot_id
       AND l.client_id = le.client_id
      WHERE le.client_id = ca.client_id
        AND le.is_active = true
        AND le.labor_type_id = ca.labor_type_id
        AND le.work_date = (ca.activity_date AT TIME ZONE 'UTC')::date
        AND (
          (ca.lot_id IS NULL AND le.cost_scope = 'farm' AND le.farm_id = ca.farm_id AND le.lot_id IS NULL)
          OR
          (ca.lot_id IS NOT NULL AND le.cost_scope = 'lot' AND le.lot_id = ca.lot_id AND l.farm_id = ca.farm_id)
        )
    ))`
  );

  const sql = `${BASE_SELECT}
     WHERE ${clauses.join(' AND ')}
     ORDER BY (ca.activity_date AT TIME ZONE 'UTC')::date ASC,
              COALESCE(l.name, '') ASC,
              lt.name ASC`;
  const res = await pool.query(sql, values);
  return res.rows.map(mapRow);
}

async function getCalendarActivityById({ id, clientId }) {
  const res = await pool.query(
    `${BASE_SELECT}
     WHERE ca.id = $1 AND ca.client_id = $2`,
    [id, clientId]
  );
  return mapRow(res.rows[0]);
}

async function assertFarmBelongsToClient({ db, farmId, clientId }) {
  const conn = db || pool;
  const farmRes = await conn.query(
    `SELECT id FROM farms WHERE id = $1 AND client_id = $2 AND is_active = true`,
    [farmId, clientId]
  );
  if (!farmRes.rows[0]) {
    const err = new Error('Finca no encontrada o no pertenece a tu organización.');
    err.status = 404;
    throw err;
  }
}

async function ensureFarmLotLabor({ db, clientId, farmId, lotId, laborTypeId }) {
  await assertFarmBelongsToClient({ db, farmId, clientId });

  if (lotId) {
    const lotRes = await db.query(
      `SELECT id FROM lots WHERE id = $1 AND farm_id = $2 AND client_id = $3 AND is_active = true`,
      [lotId, farmId, clientId]
    );
    if (!lotRes.rows[0]) {
      const err = new Error('Lote no encontrado, no pertenece a la finca o está inactivo.');
      err.status = 400;
      throw err;
    }
  }

  const ltRes = await db.query(`SELECT id FROM labor_types WHERE id = $1 AND is_active = true`, [laborTypeId]);
  if (!ltRes.rows[0]) {
    const err = new Error('Tipo de labor no encontrado o inactivo.');
    err.status = 400;
    throw err;
  }
}

function dateToActivityTimestamptz(dateStr) {
  return `${dateStr}T12:00:00.000Z`;
}

async function createCalendarActivity({ clientId, userId, body }) {
  const allowed = await loadActivityStatusLabels();
  const farmId = normalizeText(body.farm_id);
  const lotId = normalizeText(body.lot_id);
  const laborTypeId = normalizeText(body.labor_type_id);
  const dateStr = normalizeDate(body.activity_date, { required: true });
  const notes = normalizeText(body.notes);

  let status;
  if (body.status !== undefined && body.status !== null && body.status !== '') {
    status = assertStatus(body.status, allowed);
  } else {
    status = allowed.includes('pending') ? 'pending' : allowed[0];
  }

  if (!farmId || !laborTypeId) {
    const err = new Error('farm_id y labor_type_id son obligatorios.');
    err.status = 400;
    throw err;
  }

  const db = await pool.connect();
  try {
    await ensureFarmLotLabor({ db, clientId, farmId, lotId, laborTypeId });
    const insertRes = await db.query(
      `INSERT INTO calendar_activities (
         activity_date, farm_id, lot_id, labor_type_id, status, notes, client_id, created_by_user_id, updated_by_user_id
       )
       VALUES ($1::timestamptz, $2, $3, $4, $5::activity_status, $6, $7, $8, $8)
       RETURNING id`,
      [dateToActivityTimestamptz(dateStr), farmId, lotId, laborTypeId, status, notes, clientId, userId]
    );
    const id = insertRes.rows[0].id;
    const detail = await db.query(
      `${BASE_SELECT}
       WHERE ca.id = $1 AND ca.client_id = $2`,
      [id, clientId]
    );
    return mapRow(detail.rows[0]);
  } finally {
    db.release();
  }
}

async function updateCalendarActivity({ id, clientId, userId, body }) {
  const allowed = await loadActivityStatusLabels();
  const db = await pool.connect();
  try {
    const curRes = await db.query(`SELECT * FROM calendar_activities WHERE id = $1 AND client_id = $2`, [
      id,
      clientId,
    ]);
    const cur = curRes.rows[0];
    if (!cur) return null;

    const nextFarm = body.farm_id !== undefined ? normalizeText(body.farm_id) : cur.farm_id;
    const nextLot = body.lot_id !== undefined ? normalizeText(body.lot_id) : cur.lot_id;
    const nextLabor =
      body.labor_type_id !== undefined ? normalizeText(body.labor_type_id) : cur.labor_type_id;
    const nextNotes = body.notes !== undefined ? normalizeText(body.notes) : cur.notes;
    let nextDate = cur.activity_date;
    if (body.activity_date !== undefined) {
      const d = normalizeDate(body.activity_date, { required: true });
      nextDate = dateToActivityTimestamptz(d);
    }
    let nextStatus = cur.status;
    if (body.status !== undefined && body.status !== null && body.status !== '') {
      nextStatus = assertStatus(body.status, allowed);
    }

    if (
      nextFarm !== cur.farm_id ||
      nextLot !== cur.lot_id ||
      nextLabor !== cur.labor_type_id ||
      String(nextDate) !== String(cur.activity_date)
    ) {
      await ensureFarmLotLabor({ db, clientId, farmId: nextFarm, lotId: nextLot, laborTypeId: nextLabor });
    }

    await db.query(
      `UPDATE calendar_activities
       SET activity_date = $1::timestamptz,
           farm_id = $2,
           lot_id = $3,
           labor_type_id = $4,
           status = $5::activity_status,
           notes = $6,
           updated_by_user_id = $7,
           updated_at = NOW()
       WHERE id = $8 AND client_id = $9`,
      [nextDate, nextFarm, nextLot, nextLabor, nextStatus, nextNotes, userId, id, clientId]
    );

    const detail = await db.query(
      `${BASE_SELECT}
       WHERE ca.id = $1 AND ca.client_id = $2`,
      [id, clientId]
    );
    return mapRow(detail.rows[0]);
  } finally {
    db.release();
  }
}

/**
 * Alinea el cronograma cuando se registra una labor: completa pendiente/cancelada coincidente
 * o inserta una actividad realizada si no hay duplicado completado ese día.
 */
async function syncCalendarActivityFromLabor({ db, clientId, userId, entry }) {
  const laborTypeId = normalizeText(entry.labor_type_id);
  const workDate = normalizeDate(entry.work_date, { required: true, field: 'work_date' });
  const scope = String(entry.cost_scope || '').trim().toLowerCase();
  let farmId = normalizeText(entry.farm_id);
  let lotId = normalizeText(entry.lot_id);

  if (!laborTypeId) return;

  if (scope === 'lot' && lotId) {
    const lr = await db.query(`SELECT farm_id FROM lots WHERE id = $1 AND client_id = $2`, [lotId, clientId]);
    if (lr.rows[0]) farmId = lr.rows[0].farm_id;
  } else if (scope === 'farm') {
    lotId = null;
  }

  if (!farmId) return;

  const ts = dateToActivityTimestamptz(workDate);

  const pending = await db.query(
    `SELECT id FROM calendar_activities
     WHERE client_id = $1
       AND farm_id = $2
       AND labor_type_id = $3
       AND lot_id IS NOT DISTINCT FROM $4::uuid
       AND status IN ('pending', 'cancelled')
     ORDER BY activity_date DESC
     LIMIT 1`,
    [clientId, farmId, laborTypeId, lotId]
  );

  if (pending.rows[0]) {
    await db.query(
      `UPDATE calendar_activities
       SET status = 'completed'::activity_status,
           activity_date = $1::timestamptz,
           updated_by_user_id = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [ts, userId, pending.rows[0].id]
    );
    return;
  }

  const dup = await db.query(
    `SELECT id FROM calendar_activities
     WHERE client_id = $1
       AND farm_id = $2
       AND labor_type_id = $3
       AND lot_id IS NOT DISTINCT FROM $4::uuid
       AND status = 'completed'
       AND (activity_date AT TIME ZONE 'UTC')::date = $5::date
     LIMIT 1`,
    [clientId, farmId, laborTypeId, lotId, workDate]
  );
  if (dup.rows[0]) return;

  await db.query(
    `INSERT INTO calendar_activities (
       activity_date, farm_id, lot_id, labor_type_id, status, notes, client_id, created_by_user_id, updated_by_user_id
     )
     VALUES ($1::timestamptz, $2, $3, $4, 'completed'::activity_status, NULL, $5, $6, $6)`,
    [ts, farmId, lotId, laborTypeId, clientId, userId]
  );
}

module.exports = {
  loadActivityStatusLabels,
  listCalendarActivities,
  getCalendarActivityById,
  createCalendarActivity,
  updateCalendarActivity,
  syncCalendarActivityFromLabor,
};
