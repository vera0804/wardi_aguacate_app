const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireCsrf } = require('../middleware/csrf.middleware');
const { requireRoles, requireEffectiveClient } = require('../middleware/roles.middleware');
const assetCategoriesService = require('../services/asset-categories.service');

const router = express.Router();

router.use(requireAuth, requireRoles(['admin', 'operario', 'superadmin']), requireEffectiveClient);

router.get('/', async (req, res, next) => {
  try {
    let active;
    if (req.query.active !== undefined && req.query.active !== '') {
      active = assetCategoriesService.parseActiveQuery(req.query.active);
    }
    const rows = await assetCategoriesService.listAssetCategories({
      clientId: req.user.clientId,
      active,
    });
    return res.json(rows);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await assetCategoriesService.getAssetCategoryById({
      id: req.params.id,
      clientId: req.user.clientId,
    });
    if (!row) return res.status(404).json({ message: 'Categoría no encontrada.' });
    return res.json(row);
  } catch (e) {
    next(e);
  }
});

router.post('/', requireCsrf, async (req, res, next) => {
  try {
    const row = await assetCategoriesService.createAssetCategory({
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
    const row = await assetCategoriesService.updateAssetCategory({
      id: req.params.id,
      clientId: req.user.clientId,
      userId: req.user.id,
      body: req.body || {},
    });
    if (!row) return res.status(404).json({ message: 'Categoría no encontrada.' });
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
    const row = await assetCategoriesService.setAssetCategoryActive({
      id: req.params.id,
      clientId: req.user.clientId,
      userId: req.user.id,
      isActive: req.body.is_active,
    });
    if (!row) return res.status(404).json({ message: 'Categoría no encontrada.' });
    return res.json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

module.exports = router;
