const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireCsrf } = require('../middleware/csrf.middleware');
const { requireRoles, requireEffectiveClient } = require('../middleware/roles.middleware');
const service = require('../services/tenant-users.service');
const planLimits = require('../services/client-plan-limits.service');

const router = express.Router();

router.use(requireAuth, requireRoles(['admin', 'superadmin']), requireEffectiveClient);

router.get('/meta', async (req, res, next) => {
  try {
    const limits = await planLimits.getClientPlanLimits(req.user.clientId);
    const admin = await planLimits.countActiveUsersByRoleName(req.user.clientId, 'admin', {});
    const op = await planLimits.countActiveUsersByRoleName(req.user.clientId, 'operario', {});
    return res.json({
      max_users_admin: limits?.max_users_admin ?? null,
      max_users_operario: limits?.max_users_operario ?? null,
      active_admin_count: admin,
      active_operario_count: op,
    });
  } catch (e) {
    next(e);
  }
});

function parseActiveQuery(q) {
  if (q === undefined || q === null || String(q).trim() === '') return 'all';
  const v = String(q).trim().toLowerCase();
  if (v === 'all') return 'all';
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return 'all';
}

router.get('/', async (req, res, next) => {
  try {
    const active = parseActiveQuery(req.query.active);
    const rows = await service.listTenantUsers({
      clientId: req.user.clientId,
      active,
    });
    return res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.post('/', requireCsrf, async (req, res, next) => {
  try {
    const row = await service.createTenantUser({
      clientId: req.user.clientId,
      actorUserId: req.user.id,
      email: req.body?.email,
      password: req.body?.password,
      firstName: req.body?.first_name,
      lastName1: req.body?.last_name_1,
      lastName2: req.body?.last_name_2,
      phone1: req.body?.phone_1,
      phone2: req.body?.phone_2,
      idType: req.body?.id_type,
      idNumber: req.body?.id_number,
      roleName: req.body?.role,
    });
    return res.status(201).json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

router.patch('/:id/active', requireCsrf, async (req, res, next) => {
  try {
    if (req.body?.is_active === undefined) {
      return res.status(400).json({ message: 'is_active es obligatorio.' });
    }
    const row = await service.setTenantUserActive({
      id: req.params.id,
      clientId: req.user.clientId,
      actorUserId: req.user.id,
      isActive: req.body.is_active,
    });
    if (!row) {
      return res.status(404).json({ message: 'Usuario no encontrado.' });
    }
    return res.json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

router.patch('/:id', requireCsrf, async (req, res, next) => {
  try {
    const row = await service.updateTenantUser({
      id: req.params.id,
      clientId: req.user.clientId,
      actorUserId: req.user.id,
      email: req.body?.email,
      password: req.body?.password,
      firstName: req.body?.first_name,
      lastName1: req.body?.last_name_1,
      lastName2: req.body?.last_name_2,
      phone1: req.body?.phone_1,
      phone2: req.body?.phone_2,
      idType: req.body?.id_type,
      idNumber: req.body?.id_number,
      roleName: req.body?.role,
    });
    if (!row) {
      return res.status(404).json({ message: 'Usuario no encontrado.' });
    }
    return res.json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

module.exports = router;
