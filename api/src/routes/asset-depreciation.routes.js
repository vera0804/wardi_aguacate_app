const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireCsrf } = require('../middleware/csrf.middleware');
const { requireRoles, requireEffectiveClient } = require('../middleware/roles.middleware');
const assetDepreciationService = require('../services/asset-depreciation.service');

const router = express.Router();

router.use(requireAuth, requireRoles(['admin', 'superadmin']), requireEffectiveClient);

router.get('/', async (req, res, next) => {
  try {
    let active;
    if (req.query.active !== undefined && req.query.active !== '') {
      active = assetDepreciationService.parseActiveQuery(req.query.active);
    }
    const rows = await assetDepreciationService.listAssetDepreciation({
      clientId: req.user.clientId,
      assetId: req.query.asset_id,
      active,
    });
    return res.json(rows);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

router.post('/calculate', requireCsrf, async (req, res, next) => {
  try {
    const rows = await assetDepreciationService.calculateAssetDepreciation({
      clientId: req.user.clientId,
      userId: req.user.id,
      assetId: req.body?.asset_id,
    });
    return res.status(200).json(rows);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

module.exports = router;
