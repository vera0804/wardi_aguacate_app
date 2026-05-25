const DEFAULT_TIMEZONE = 'America/Costa_Rica';

const BILLING_MODEL_LABELS = {
  perpetual: 'Sin vencimiento',
  trial_days: 'Demo por días',
  monthly_anchor: 'Mensual (día ancla)',
};

function billingModelLabel(model) {
  const key = String(model || '').trim().toLowerCase();
  return BILLING_MODEL_LABELS[key] || key || '—';
}

/** @returns {string} YYYY-MM-DD en la zona IANA indicada */
function todayYmdInTimezone(timezone = DEFAULT_TIMEZONE) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function parseYmd(value) {
  const s = String(value || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

function formatYmd({ y, m, d }) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function addCalendarDaysYmd(ymdStr, days) {
  const p = parseYmd(ymdStr);
  if (!p) return null;
  const dt = new Date(p.y, p.m - 1, p.d);
  dt.setDate(dt.getDate() + days);
  return formatYmd({ y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate() });
}

function compareYmd(a, b) {
  const pa = parseYmd(a);
  const pb = parseYmd(b);
  if (!pa || !pb) return 0;
  if (pa.y !== pb.y) return pa.y < pb.y ? -1 : 1;
  if (pa.m !== pb.m) return pa.m < pb.m ? -1 : 1;
  if (pa.d !== pb.d) return pa.d < pb.d ? -1 : 1;
  return 0;
}

/** dd-mm-yyyy para UI */
function formatDisplayYmd(ymdStr) {
  const p = parseYmd(ymdStr);
  if (!p) return null;
  return `${String(p.d).padStart(2, '0')}-${String(p.m).padStart(2, '0')}-${p.y}`;
}

/**
 * Normaliza DATE de PostgreSQL (Date en Node) o texto a YYYY-MM-DD.
 * Evita String(date) → "Sat Jun 21" y desfases al usar componentes UTC (node-pg).
 */
function toIsoDateFromDb(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return formatYmd({
      y: value.getUTCFullYear(),
      m: value.getUTCMonth() + 1,
      d: value.getUTCDate(),
    });
  }
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const head = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (head) return `${head[1]}-${head[2]}-${head[3]}`;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return formatYmd({
      y: parsed.getUTCFullYear(),
      m: parsed.getUTCMonth() + 1,
      d: parsed.getUTCDate(),
    });
  }
  return null;
}

/** dd-mm-yyyy para vencimiento de licencia (API / PWA). */
function formatLicenseExpiryDisplay(value) {
  const iso = toIsoDateFromDb(value);
  if (!iso) return null;
  return formatDisplayYmd(iso);
}

function clampAnchorDay(day) {
  const n = Number(day);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  if (i < 1 || i > 28) return null;
  return i;
}

/**
 * @param {{ billingModel: string, trialDays?: number|null, trialDaysOverride?: number|null, licenseStartsOn: string, billingAnchorDay?: number|null }} params
 * @returns {{ licenseStartsOn: string, licenseExpiresOn: string|null, billingAnchorDay: number|null }}
 */
function computeLicenseDates({
  billingModel,
  trialDays,
  trialDaysOverride,
  licenseStartsOn,
  billingAnchorDay,
}) {
  const model = String(billingModel || '').trim().toLowerCase();
  const starts = parseYmd(licenseStartsOn);
  if (!starts) {
    const err = new Error('license_starts_on debe ser YYYY-MM-DD.');
    err.status = 400;
    throw err;
  }
  const startsYmd = formatYmd(starts);

  if (model === 'perpetual') {
    return { licenseStartsOn: startsYmd, licenseExpiresOn: null, billingAnchorDay: null };
  }

  if (model === 'trial_days') {
    const n = Number(trialDaysOverride ?? trialDays);
    if (!Number.isFinite(n) || n < 1) {
      const err = new Error('El plan requiere días de demo válidos.');
      err.status = 400;
      throw err;
    }
    const expires = addCalendarDaysYmd(startsYmd, Math.trunc(n));
    return { licenseStartsOn: startsYmd, licenseExpiresOn: expires, billingAnchorDay: null };
  }

  if (model === 'monthly_anchor') {
    const anchor =
      clampAnchorDay(billingAnchorDay) ?? clampAnchorDay(starts.d) ?? starts.d;
    if (!anchor) {
      const err = new Error('billing_anchor_day debe estar entre 1 y 28.');
      err.status = 400;
      throw err;
    }
    let nextM = starts.m + 1;
    let nextY = starts.y;
    if (nextM > 12) {
      nextM = 1;
      nextY += 1;
    }
    const lastDom = daysInMonth(nextY, nextM);
    const expireDay = Math.min(anchor, lastDom);
    const expiresYmd = formatYmd({ y: nextY, m: nextM, d: expireDay });
    return {
      licenseStartsOn: startsYmd,
      licenseExpiresOn: expiresYmd,
      billingAnchorDay: anchor,
    };
  }

  const err = new Error(`billing_model no soportado: ${model}`);
  err.status = 400;
  throw err;
}

function isDateAfterToday(expiresYmd, todayYmd) {
  if (!expiresYmd) return false;
  return compareYmd(todayYmd, expiresYmd) > 0;
}

function isDateOnOrBefore(expiresYmd, todayYmd) {
  if (!expiresYmd) return true;
  return compareYmd(todayYmd, expiresYmd) <= 0;
}

module.exports = {
  DEFAULT_TIMEZONE,
  BILLING_MODEL_LABELS,
  billingModelLabel,
  todayYmdInTimezone,
  parseYmd,
  formatYmd,
  formatDisplayYmd,
  toIsoDateFromDb,
  formatLicenseExpiryDisplay,
  addCalendarDaysYmd,
  compareYmd,
  computeLicenseDates,
  clampAnchorDay,
  isDateAfterToday,
  isDateOnOrBefore,
};
