/**
 * Tipo de cambio USD vía API REST pública SDDE del BCCR (Bearer + JSON).
 * Variables: BCCR_API_URL (base HTTPS, allowlist/DNS), BCCR_ALLOWED_HOSTS (opcional),
 * BCCR_TOKEN, BCCR_INDICADOR_VENTA (318), BCCR_INDICADOR_COMPRA (317).
 */

const { validateBccrFetchTarget } = require('../lib/bccrUrlSafety');

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 2;
const REST_IDIOMA = 'ES';

/** @type {Map<string, { rate: number, storedAt: number, validUntil: number }>} */
const memoryCache = new Map();

/**
 * @param {string} isoDate YYYY-MM-DD
 * @returns {string} yyyy/mm/dd
 */
function isoToBccrSlashDate(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) throw Object.assign(new Error('La fecha debe ser YYYY-MM-DD.'), { status: 400 });
  return `${m[1]}/${m[2]}/${m[3]}`;
}

/**
 * @param {string} codigo
 */
function assertIndicatorCode(codigo) {
  const c = String(codigo || '').trim();
  if (!/^\d{2,6}$/.test(c)) {
    throw Object.assign(new Error('Código de indicador BCCR inválido en configuración.'), { status: 500 });
  }
  return c;
}

/**
 * @param {string} validatedBase href normalizado de BCCR_API_URL
 * @param {string} codigo
 * @param {string} isoDate YYYY-MM-DD
 */
function buildSeriesRequestUrl(validatedBase, codigo, isoDate) {
  const base = String(validatedBase).replace(/\/$/, '');
  const fecha = isoToBccrSlashDate(isoDate);
  const safeCodigo = assertIndicatorCode(codigo);
  const u = new URL(`indicadoresEconomicos/${encodeURIComponent(safeCodigo)}/series`, `${base}/`);
  u.searchParams.set('fechaInicio', fecha);
  u.searchParams.set('fechaFin', fecha);
  u.searchParams.set('idioma', REST_IDIOMA);
  return u.href;
}

/**
 * @param {unknown} payload
 * @param {string} [isoDate] preferir punto de la serie que coincide con la fecha pedida
 * @returns {number}
 */
function extractRateFromRestJson(payload, isoDate) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Respuesta BCCR vacía o inválida.');
  }
  if (payload.estado !== true) {
    throw new Error(
      typeof payload.mensaje === 'string' && payload.mensaje.trim()
        ? payload.mensaje.trim()
        : 'BCCR rechazó la consulta.'
    );
  }
  const datos = payload.datos;
  if (!Array.isArray(datos) || datos.length === 0) {
    throw new Error('BCCR no devolvió datos para el indicador.');
  }
  const series = datos[0]?.series;
  if (!Array.isArray(series) || series.length === 0) {
    throw new Error('BCCR no devolvió serie para la fecha solicitada.');
  }

  let point = series[0];
  if (isoDate) {
    const match = series.find((s) => String(s?.fecha || '').slice(0, 10) === isoDate);
    if (match) point = match;
  }

  const rate = Number(point?.valorDatoPorPeriodo);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('Tipo de cambio inválido en la respuesta del BCCR.');
  }
  return rate;
}

/**
 * @param {number} status
 * @param {object|null} json
 */
function httpErrorFromBccrStatus(status, json) {
  const remoteMsg =
    json && typeof json.mensaje === 'string' && json.mensaje.trim() ? json.mensaje.trim() : null;

  let message;
  let errStatus = 502;

  switch (status) {
    case 401:
      message = 'BCCR rechazó el token (401). Verifique BCCR_TOKEN.';
      break;
    case 403:
      message = 'BCCR denegó el acceso (403). Revise permisos del token.';
      break;
    case 429:
      message = 'BCCR limitó las consultas (429). Intente más tarde.';
      errStatus = 503;
      break;
    case 500:
    case 502:
    case 503:
      message = remoteMsg ? `BCCR error ${status}: ${remoteMsg}` : `BCCR error ${status}.`;
      break;
    default:
      message = remoteMsg ? `BCCR HTTP ${status}: ${remoteMsg}` : `BCCR HTTP ${status}.`;
  }

  const err = new Error(message);
  err.status = errStatus;
  return err;
}

function getBccrEnvOrThrow() {
  const url = process.env.BCCR_API_URL && String(process.env.BCCR_API_URL).trim();
  const token = process.env.BCCR_TOKEN && String(process.env.BCCR_TOKEN).trim();
  if (!url || !token) {
    const err = new Error(
      'Falta configuración BCCR: defina BCCR_API_URL y BCCR_TOKEN en el entorno del servidor.'
    );
    err.status = 500;
    throw err;
  }
  return { url, token };
}

function getIndicatorForKind(kind) {
  const v =
    kind === 'compra'
      ? process.env.BCCR_INDICADOR_COMPRA && String(process.env.BCCR_INDICADOR_COMPRA).trim()
      : process.env.BCCR_INDICADOR_VENTA && String(process.env.BCCR_INDICADOR_VENTA).trim();
  if (!v) {
    const err = new Error(
      kind === 'compra'
        ? 'Falta BCCR_INDICADOR_COMPRA en el entorno del servidor.'
        : 'Falta BCCR_INDICADOR_VENTA en el entorno del servidor.'
    );
    err.status = 500;
    throw err;
  }
  return assertIndicatorCode(v);
}

function cacheKey(date, kind) {
  return `${date}:${kind}`;
}

function readFreshCache(key) {
  const e = memoryCache.get(key);
  if (!e) return null;
  if (Date.now() < e.validUntil) {
    return { rate: e.rate, source: 'cache', stale: false, warning: null };
  }
  return null;
}

function readStaleCache(key) {
  const e = memoryCache.get(key);
  if (!e) return null;
  return {
    rate: e.rate,
    source: 'cache',
    stale: true,
    warning: 'Último valor conocido: el servicio del BCCR no respondió; revise la conexión o intente más tarde.',
  };
}

function writeCache(key, rate) {
  const now = Date.now();
  memoryCache.set(key, {
    rate,
    storedAt: now,
    validUntil: now + CACHE_TTL_MS,
  });
}

/**
 * @param {{ url: string, token: string }} params
 * @returns {Promise<object>}
 */
async function fetchBccrRestOnce({ url, token }) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });

    if (res.status >= 300 && res.status < 400) {
      const err = new Error(`BCCR rechazado: redirección HTTP ${res.status} (no permitida por SSRF)`);
      err.status = 502;
      throw err;
    }

    const text = await res.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        const err = new Error('BCCR devolvió una respuesta no JSON.');
        err.status = 502;
        throw err;
      }
    }

    if (!res.ok) {
      throw httpErrorFromBccrStatus(res.status, json);
    }

    return json;
  } finally {
    clearTimeout(tid);
  }
}

/**
 * @param {{ date: string, kind?: 'venta'|'compra' }} opts
 * @returns {Promise<{ date: string, kind: string, rate: number, source: 'bccr'|'cache', stale: boolean, warning: string | null }>}
 */
async function getUsdExchangeRate(opts) {
  const kind = opts.kind === 'compra' ? 'compra' : 'venta';
  const { date } = opts;
  const key = cacheKey(date, kind);

  const fresh = readFreshCache(key);
  if (fresh) {
    return { date, kind, rate: fresh.rate, source: fresh.source, stale: false, warning: null };
  }

  const { url, token } = getBccrEnvOrThrow();
  const validatedBase = await validateBccrFetchTarget(url);
  const codigo = getIndicatorForKind(kind);
  const seriesUrl = buildSeriesRequestUrl(validatedBase, codigo, date);
  const validatedSeriesUrl = await validateBccrFetchTarget(seriesUrl);

  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const json = await fetchBccrRestOnce({ url: validatedSeriesUrl, token });
      const rate = extractRateFromRestJson(json, date);
      writeCache(key, rate);
      return { date, kind, rate, source: 'bccr', stale: false, warning: null };
    } catch (e) {
      lastErr = e;
    }
  }

  const stale = readStaleCache(key);
  if (stale) {
    return { date, kind, rate: stale.rate, source: 'cache', stale: true, warning: stale.warning };
  }

  let msg = 'No se pudo obtener el tipo de cambio del BCCR.';
  let status = 503;

  if (lastErr?.name === 'AbortError') {
    msg = 'Tiempo de espera agotado al consultar el BCCR.';
  } else if (lastErr?.message) {
    msg = lastErr.message;
    if (Number.isInteger(lastErr.status) && lastErr.status >= 400 && lastErr.status < 600) {
      status = lastErr.status;
    }
  }

  const err = new Error(msg);
  err.status = status;
  err.cause = lastErr;
  throw err;
}

module.exports = {
  getUsdExchangeRate,
  isoToBccrSlashDate,
  buildSeriesRequestUrl,
  extractRateFromRestJson,
  httpErrorFromBccrStatus,
};
