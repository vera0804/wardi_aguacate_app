const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireCsrf } = require('../middleware/csrf.middleware');
const { requireRoles, requireEffectiveClient, requireWritePermission } = require('../middleware/roles.middleware');
const mixService = require('../services/mix-applications.service');
const consumptionsService = require('../services/inventory-consumptions.service');

const router = express.Router();

router.use(requireAuth, requireRoles(['admin', 'operario', 'superadmin']), requireEffectiveClient);

router.get('/', async (req, res, next) => {
  try {
    let active;
    if (req.query.active !== undefined && req.query.active !== '') {
      const v = String(req.query.active).toLowerCase();
      if (v === 'true' || v === '1') active = true;
      else if (v === 'false' || v === '0') active = false;
      else if (v === 'all') active = 'all';
    }
    const rows = await mixService.listMixApplications({
      clientId: req.user.clientId,
      active,
      lotId: req.query.lot_id || undefined,
      farmId: req.query.farm_id || undefined,
      fromDate: req.query.from_date || undefined,
      toDate: req.query.to_date || undefined,
    });
    return res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.patch('/:id/active', requireCsrf, requireWritePermission, async (req, res, next) => {
  const hasIsActive = Object.prototype.hasOwnProperty.call(req.body || {}, 'is_active');
  if (!hasIsActive || req.body.is_active !== false) {
    return res.status(400).json({ message: 'Solo se permite inactivar la mezcla (is_active: false).' });
  }
  try {
    const result = await consumptionsService.deactivateMixApplication({
      clientId: req.user.clientId,
      userId: req.user.id,
      mixApplicationId: req.params.id,
    });
    if (!result) return res.status(404).json({ message: 'Mezcla no encontrada.' });
    return res.json(result);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await mixService.getMixApplicationById({
      clientId: req.user.clientId,
      id: req.params.id,
    });
    if (!row) return res.status(404).json({ message: 'Mezcla no encontrada.' });
    return res.json(row);
  } catch (e) {
    next(e);
  }
});

router.post('/', requireCsrf, requireWritePermission, async (req, res, next) => {
  try {
    const result = await mixService.createMixApplication({
      clientId: req.user.clientId,
      userId: req.user.id,
      body: req.body || {},
    });
    return res.status(201).json(result);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

module.exports = router;
