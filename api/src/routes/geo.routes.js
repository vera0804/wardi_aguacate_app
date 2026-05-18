const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireRoles } = require('../middleware/roles.middleware');
const geoService = require('../services/geo.service');

const router = express.Router();

router.use(requireAuth, requireRoles(['admin', 'operario', 'superadmin']));

router.get('/provinces', async (_req, res, next) => {
  try {
    const rows = await geoService.listProvinces();
    return res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.get('/cantons', async (req, res, next) => {
  try {
    const rows = await geoService.listCantonsByProvince(req.query.province_id);
    return res.json(rows);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

router.get('/districts', async (req, res, next) => {
  try {
    const rows = await geoService.listDistrictsByCanton(req.query.canton_id);
    return res.json(rows);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

module.exports = router;
