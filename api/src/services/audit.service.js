const crypto = require('crypto');
const { pool } = require('../db');

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function safeTrim(v, maxLen) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  return maxLen ? s.slice(0, maxLen) : s;
}

async function logSecurityEvent({
  eventType,
  userId = null,
  clientId = null,
  identifier = null,
  ipAddress = null,
  userAgent = null,
  metadata = {},
} = {}) {
  try {
    const identifierHash =
      identifier != null ? sha256Hex(String(identifier).toLowerCase().trim()) : null;
    const userAgentHash = userAgent ? sha256Hex(userAgent) : null;

    await pool.query(
      `INSERT INTO public.security_audit_logs
        (event_type, user_id, client_id, identifier_hash, ip_address, user_agent_hash, metadata)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7)`,
      [
        eventType,
        userId,
        clientId,
        identifierHash,
        safeTrim(ipAddress, 64),
        userAgentHash,
        metadata || {},
      ]
    );
  } catch (e) {
    // Best-effort: nunca romper autenticación por fallos de auditoría.
  }
}

module.exports = {
  logSecurityEvent,
};

