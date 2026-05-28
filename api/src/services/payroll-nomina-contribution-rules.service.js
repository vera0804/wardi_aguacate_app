const { pool } = require('../db');

function normalizeDate(value, { required = false, field = 'fecha' } = {}) {
  if (value == null || String(value).trim() === '') {
    if (required) {
      const err = new Error(`El campo ${field} es obligatorio.`);
      err.status = 400;
      throw err;
    }
    return null;
  }
  const s = String(value).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const err = new Error(`${field} debe ser una fecha YYYY-MM-DD.`);
    err.status = 400;
    throw err;
  }
  return s;
}

function normalizePct(value, { field, required = true, defaultValue = null }) {
  if (value == null || value === '') {
    if (!required && defaultValue != null) return defaultValue;
    if (!required) return 0;
    const err = new Error(`El campo ${field} es obligatorio.`);
    err.status = 400;
    throw err;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    const err = new Error(`${field} debe ser un número entre 0 y 100 (porcentaje sobre salario bruto).`);
    err.status = 400;
    throw err;
  }
  return n;
}

function normalizeNotes(value) {
  if (value == null) return null;
  const t = String(value).trim();
  return t ? t.slice(0, 2000) : null;
}

function parseActiveQuery(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v || v === 'all') return 'all';
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  const err = new Error('El parámetro active debe ser true, false o all.');
  err.status = 400;
  throw err;
}

/**
 * Traslape de intervalos inclusivos; fin NULL = vigencia abierta (se trata como fecha muy lejana).
 */
async function assertNoOverlapWithActiveRules({ clientId, validFrom, validTo, excludeId = null }) {
  const res = await pool.query(
    `SELECT id, valid_from, valid_to
     FROM payroll_nomina_contribution_rules
     WHERE client_id = $1
       AND is_active = true
       AND ($4::uuid IS NULL OR id <> $4::uuid)
       AND valid_from <= COALESCE($3::date, DATE '9999-12-31')
       AND COALESCE(valid_to, DATE '9999-12-31') >= $2::date
     LIMIT 1`,
    [clientId, validFrom, validTo, excludeId]
  );
  if (res.rows[0]) {
    const err = new Error(
      'El periodo se traslapa con otra regla activa. Inactive la regla anterior o use fechas que no se crucen con una regla vigente.'
    );
    err.status = 409;
    throw err;
  }
}

async function listNominaContributionRules({ clientId, active }) {
  const clauses = ['client_id = $1'];
  const values = [clientId];
  let idx = 2;

  if (active === true) {
    clauses.push(`is_active = $${idx++}`);
    values.push(true);
  } else if (active === false) {
    clauses.push(`is_active = $${idx++}`);
    values.push(false);
  }

  const res = await pool.query(
    `SELECT id, client_id, valid_from, valid_to,
            employer_ccss_pct_of_gross, employer_other_pct_of_gross, employee_pct_of_gross,
            notes, is_active, deactivated_at,
            created_at, updated_at, created_by_user_id, updated_by_user_id
     FROM payroll_nomina_contribution_rules
     WHERE ${clauses.join(' AND ')}
     ORDER BY valid_from DESC, created_at DESC`,
    values
  );
  return res.rows;
}

async function createNominaContributionRule({
  clientId,
  userId,
  validFrom,
  validTo,
  employerCcssPctOfGross,
  employerOtherPctOfGross,
  employeePctOfGross,
  notes,
}) {
  const vf = normalizeDate(validFrom, { required: true, field: 'valid_from' });
  const vt = normalizeDate(validTo, { required: false, field: 'valid_to' });
  if (vt != null && vf > vt) {
    const err = new Error('La fecha de inicio no puede ser posterior a la fecha de finalización.');
    err.status = 400;
    throw err;
  }
  const ccss = normalizePct(employerCcssPctOfGross, { field: 'employer_ccss_pct_of_gross' });
  const other = normalizePct(employerOtherPctOfGross, {
    field: 'employer_other_pct_of_gross',
    required: false,
    defaultValue: 0,
  });
  const epl = normalizePct(employeePctOfGross, { field: 'employee_pct_of_gross' });
  const n = normalizeNotes(notes);

  await assertNoOverlapWithActiveRules({ clientId, validFrom: vf, validTo: vt });

  const ins = await pool.query(
    `INSERT INTO payroll_nomina_contribution_rules (
       client_id, valid_from, valid_to,
       employer_ccss_pct_of_gross, employer_other_pct_of_gross, employee_pct_of_gross,
       notes, is_active, created_by_user_id, updated_by_user_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $8)
     RETURNING id, client_id, valid_from, valid_to,
               employer_ccss_pct_of_gross, employer_other_pct_of_gross, employee_pct_of_gross,
               notes, is_active, deactivated_at,
               created_at, updated_at, created_by_user_id, updated_by_user_id`,
    [clientId, vf, vt, ccss, other, epl, n, userId]
  );
  return ins.rows[0];
}

async function deactivateNominaContributionRule({ id, clientId, userId }) {
  const res = await pool.query(
    `UPDATE payroll_nomina_contribution_rules
     SET is_active = false,
         deactivated_at = NOW(),
         updated_at = NOW(),
         updated_by_user_id = $3
     WHERE id = $1
       AND client_id = $2
       AND is_active = true
     RETURNING id, client_id, valid_from, valid_to,
               employer_ccss_pct_of_gross, employer_other_pct_of_gross, employee_pct_of_gross,
               notes, is_active, deactivated_at,
               created_at, updated_at, created_by_user_id, updated_by_user_id`,
    [id, clientId, userId]
  );
  return res.rows[0] || null;
}

module.exports = {
  listNominaContributionRules,
  createNominaContributionRule,
  deactivateNominaContributionRule,
  parseActiveQuery,
};
