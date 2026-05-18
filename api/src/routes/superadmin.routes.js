const express = require('express');
const { requireAuth, clientIp } = require('../middleware/auth.middleware');
const { requireCsrf } = require('../middleware/csrf.middleware');
const { requireSuperadmin } = require('../middleware/roles.middleware');
const auditService = require('../services/audit.service');
const authService = require('../services/auth.service');
const superadminService = require('../services/superadmin.service');

const router = express.Router();

router.use(requireAuth, requireSuperadmin);

router.get('/plans', async (req, res, next) => {
  try {
    const rows = await superadminService.listPlans();
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.get('/clients', async (req, res, next) => {
  try {
    const rows = await superadminService.listClients();
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.post('/clients', requireCsrf, async (req, res, next) => {
  try {
    const b = req.body || {};
    const row = await superadminService.createClientWithAdmin({
      clientName: b.client_name,
      planId: b.plan_id,
      adminEmail: b.admin_email,
      adminPasswordPlain: b.admin_password,
      adminFirstName: b.admin_first_name,
      adminLastName1: b.admin_last_name_1,
      adminLastName2: b.admin_last_name_2,
      createdBySuperadminUserId: req.user.id,
    });
    auditService.logSecurityEvent({
      eventType: 'superadmin_client_created',
      userId: req.user.id,
      clientId: row?.id || null,
      identifier: b.admin_email,
      ipAddress: clientIp(req),
      userAgent: req.headers['user-agent'] || null,
      metadata: {
        clientName: row?.name || null,
        planId: row?.plan_id || null,
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

router.post('/session/tenant', requireCsrf, async (req, res, next) => {
  const clientId = String(req.body?.client_id || '').trim();
  if (!clientId) {
    return res.status(400).json({ message: 'client_id es obligatorio.' });
  }
  try {
    const ok = await authService.setSessionActingClient({
      sessionId: req.auth.sessionId,
      superadminUserId: req.user.id,
      actingClientId: clientId,
    });
    if (!ok) {
      return res.status(404).json({ message: 'No se pudo asignar la organización (sesión o cliente inválido).' });
    }
    const tokenHash = req.auth.tokenHash;
    const row = await authService.findActiveSessionByTokenHash(tokenHash);
    if (!row) {
      return res.status(401).json({ message: 'Sesión inválida.' });
    }
    auditService.logSecurityEvent({
      eventType: 'superadmin_tenant_selected',
      userId: req.user.id,
      clientId: clientId,
      ipAddress: clientIp(req),
      userAgent: req.headers['user-agent'] || null,
      metadata: { actingClientId: clientId },
    });
    return res.json(authService.mapUserPayloadFromSessionRow(row));
  } catch (e) {
    next(e);
  }
});

router.delete('/session/tenant', requireCsrf, async (req, res, next) => {
  const clearedActingClientId = req.user?.actingClientId || null;
  try {
    await authService.clearSessionActingClient({
      sessionId: req.auth.sessionId,
      superadminUserId: req.user.id,
    });
    const tokenHash = req.auth.tokenHash;
    const row = await authService.findActiveSessionByTokenHash(tokenHash);
    if (!row) {
      return res.status(401).json({ message: 'Sesión inválida.' });
    }
    auditService.logSecurityEvent({
      eventType: 'superadmin_tenant_cleared',
      userId: req.user.id,
      clientId: clearedActingClientId,
      ipAddress: clientIp(req),
      userAgent: req.headers['user-agent'] || null,
      metadata: { clearedActingClientId },
    });
    return res.json(authService.mapUserPayloadFromSessionRow(row));
  } catch (e) {
    next(e);
  }
});

module.exports = router;
