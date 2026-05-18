const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireCsrf } = require('../middleware/csrf.middleware');
const { requireRoles, requireEffectiveClient } = require('../middleware/roles.middleware');
const assetsService = require('../services/assets.service');

const router = express.Router();

router.use(requireAuth, requireRoles(['admin', 'superadmin']), requireEffectiveClient);

router.get('/', async (req, res, next) => {
  try {
    let active;
    const rawActive = req.query.active;
    if (rawActive !== undefined && rawActive !== null && String(rawActive).trim() !== '') {
      active = assetsService.parseActiveQuery(rawActive);
    }
    const rows = await assetsService.listAssets({
      clientId: req.user.clientId,
      active,
      categoryId: req.query.category_id || undefined,
      q: req.query.q || undefined,
    });
    return res.json(rows);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await assetsService.getAssetById({ id: req.params.id, clientId: req.user.clientId });
    if (!row) return res.status(404).json({ message: 'Activo no encontrado.' });
    return res.json(row);
  } catch (e) {
    next(e);
  }
});

router.post('/', requireCsrf, async (req, res, next) => {
  try {
    const row = await assetsService.createAsset({
      clientId: req.user.clientId,
      userId: req.user.id,
      body: req.body || {},
    });
    return res.status(201).json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

router.patch('/:id', requireCsrf, async (req, res, next) => {
  try {
    const row = await assetsService.updateAsset({
      id: req.params.id,
      clientId: req.user.clientId,
      userId: req.user.id,
      body: req.body || {},
    });
    if (!row) return res.status(404).json({ message: 'Activo no encontrado.' });
    return res.json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

router.patch('/:id/active', requireCsrf, async (req, res, next) => {
  const has = Object.prototype.hasOwnProperty.call(req.body || {}, 'is_active');
  if (!has || typeof req.body.is_active !== 'boolean') {
    return res.status(400).json({ message: 'is_active (boolean) es obligatorio.' });
  }
  try {
    const row = await assetsService.setAssetActive({
      id: req.params.id,
      clientId: req.user.clientId,
      userId: req.user.id,
      isActive: req.body.is_active,
      body: req.body || {},
    });
    if (!row) return res.status(404).json({ message: 'Activo no encontrado.' });
    return res.json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

module.exports = router;
