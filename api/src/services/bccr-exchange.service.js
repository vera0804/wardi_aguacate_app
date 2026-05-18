/**
 * Consulta tipo de cambio USD vía SOAP del BCCR (SDDE), con caché en memoria y reintentos.
 * Variables: BCCR_API_URL (solo HTTPS, host en lista blanca/DNS validado), BCCR_ALLOWED_HOSTS (opcional),
 * BCCR_TOKEN, BCCR_INDICADOR_VENTA, BCCR_INDICADOR_COMPRA, opcional BCCR_NOMBRE, BCCR_CORREO.
 */

const { validateBccrFetchTarget } = require('../lib/bccrUrlSafety');

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 2;
/** SOAP 1.1: muchos endpoints .asmx esperan la URI entre comillas. */
const SOAP_ACTION = '"http://ws.sdde.bccr.fi.cr/ObtenerIndicadoresEconomicosXML"';

/** @type {Map<string, { rate: number, storedAt: number, validUntil: number }>} */
const memoryCache = new Map();

function escapeXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {string} isoDate YYYY-MM-DD
 * @returns {string} dd/mm/yyyy
 */
function isoToDdMmYyyy(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) throw Object.assign(new Error('La fecha debe ser YYYY-MM-DD.'), { status: 400 });
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function buildSoapEnvelope({ indicador, fechaDdMmYyyy, nombre, correo, token }) {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ObtenerIndicadoresEconomicosXML xmlns="http://ws.sdde.bccr.fi.cr">
      <Indicador>${escapeXml(indicador)}</Indicador>
      <FechaInicio>${escapeXml(fechaDdMmYyyy)}</FechaInicio>
      <FechaFinal>${escapeXml(fechaDdMmYyyy)}</FechaFinal>
      <Nombre>${escapeXml(nombre)}</Nombre>
      <SubNiveles>N</SubNiveles>
      <CorreoElectronico>${escapeXml(correo)}</CorreoElectronico>
      <Token>${escapeXml(token)}</Token>
    </ObtenerIndicadoresEconomicosXML>
  </soap:Body>
</soap:Envelope>`;
}

function decodeXmlEntities(text) {
  let s = String(text);
  while (s.includes('&amp;')) {
    s = s.replace(/&amp;/g, '&');
  }
  return s
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function parseLocaleNumber(raw) {
  const s = String(raw).trim();
  if (!s) return NaN;
  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      return Number(s.replace(/\./g, '').replace(',', '.'));
    }
    return Number(s.replace(/,/g, ''));
  }
  if (s.includes(',')) return Number(s.replace(/\./g, '').replace(',', '.'));
  return Number(s.replace(/,/g, ''));
}

/**
 * @param {string} soapXmlText
 * @returns {number}
 */
function extractRateFromSoap(soapXmlText) {
  const decoded = decodeXmlEntities(soapXmlText);
  const reResult = /<ObtenerIndicadoresEconomicosXMLResult>([\s\S]*?)<\/ObtenerIndicadoresEconomicosXMLResult>/i;
  const mr = decoded.match(reResult);
  let payload = mr ? mr[1].trim() : decoded;
  const cdata = payload.match(/<!\[CDATA\[([\s\S]*?)\]\]>/i);
  if (cdata) payload = decodeXmlEntities(cdata[1].trim());

  const patterns = [
    /<NUM_VALOR>\s*([\d.,]+)\s*<\/NUM_VALOR>/i,
    /<DES_VALOR>\s*([\d.,]+)\s*<\/DES_VALOR>/i,
    /<VALOR>\s*([\d.,]+)\s*<\/VALOR>/i,
    /NUM_VALOR["']?\s*>\s*([\d.,]+)/i,
  ];
  for (const re of patterns) {
    const m = payload.match(re);
    if (m && m[1]) {
      const n = parseLocaleNumber(m[1]);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  throw new Error('No se pudo interpretar el tipo de cambio en la respuesta del BCCR.');
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
  const nombre = (process.env.BCCR_NOMBRE && String(process.env.BCCR_NOMBRE).trim()) || 'Wardi';
  const correo = (process.env.BCCR_CORREO && String(process.env.BCCR_CORREO).trim()) || '';
  return { url, token, nombre, correo };
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
  return v;
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

async function fetchBccrSoapOnce({ url, body }) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: SOAP_ACTION,
      },
      body,
      signal: controller.signal,
    });
    if (res.status >= 300 && res.status < 400) {
      const err = new Error(`BCCR rechazado: redirección HTTP ${res.status} (no permitida por SSRF)`);
      err.status = 502;
      throw err;
    }
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`BCCR HTTP ${res.status}`);
      err.status = 502;
      throw err;
    }
    return text;
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

  const { url, token, nombre, correo } = getBccrEnvOrThrow();
  const validatedUrl = await validateBccrFetchTarget(url);
  const indicador = getIndicatorForKind(kind);
  const fechaSoap = isoToDdMmYyyy(date);
  const body = buildSoapEnvelope({
    indicador,
    fechaDdMmYyyy: fechaSoap,
    nombre,
    correo,
    token,
  });

  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const xml = await fetchBccrSoapOnce({ url: validatedUrl, body });
      const rate = extractRateFromSoap(xml);
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

  const msg =
    lastErr && lastErr.name === 'AbortError'
      ? 'Tiempo de espera agotado al consultar el BCCR.'
      : 'No se pudo obtener el tipo de cambio del BCCR.';
  const err = new Error(msg);
  err.status = 503;
  err.cause = lastErr;
  throw err;
}

module.exports = {
  getUsdExchangeRate,
  buildSoapEnvelope,
  extractRateFromSoap,
  isoToDdMmYyyy,
};
