const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireCsrf } = require('../middleware/csrf.middleware');
const { requireRoles, requireEffectiveClient, requireWritePermission } = require('../middleware/roles.middleware');
const farmsService = require('../services/farms.service');

const router = express.Router();

router.use(requireAuth, requireRoles(['admin', 'operario', 'superadmin']), requireEffectiveClient);

router.get('/', async (req, res) => {
  const includeInactive = String(req.query.includeInactive || '').toLowerCase() === 'true';
  try {
    const rows = await farmsService.listFarms({
      clientId: req.user.clientId,
      includeInactive,
    });
    return res.json(rows);
  } catch (e) {
    console.error('GET /farms', e);
    return res.status(500).json({ message: 'No se pudieron cargar las fincas.' });
  }
});

router.post('/', requireCsrf, requireWritePermission, async (req, res) => {
  try {
    const farm = await farmsService.createFarm({
      clientId: req.user.clientId,
      userId: req.user.id,
      name: req.body?.name,
      provinceId: req.body?.province_id,
      cantonId: req.body?.canton_id,
      districtId: req.body?.district_id,
      community: req.body?.community,
      areaHa: req.body?.area_ha,
      laborAllocationMode: req.body?.labor_allocation_mode,
    });
    return res.status(201).json(farm);
  } catch (e) {
    if (e.status) {
      return res.status(e.status).json({ message: e.message });
    }
    console.error('POST /farms', e);
    return res.status(500).json({ message: 'No se pudo crear la finca.' });
  }
});

router.patch('/:farmId', requireCsrf, requireWritePermission, async (req, res) => {
  try {
    const farm = await farmsService.updateFarm({
      farmId: req.params.farmId,
      clientId: req.user.clientId,
      userId: req.user.id,
      name: req.body?.name,
      provinceId: req.body?.province_id,
      cantonId: req.body?.canton_id,
      districtId: req.body?.district_id,
      community: req.body?.community,
      areaHa: req.body?.area_ha,
      laborAllocationMode: req.body?.labor_allocation_mode,
    });
    if (!farm) {
      return res.status(404).json({ message: 'Finca no encontrada.' });
    }
    return res.json(farm);
  } catch (e) {
    if (e.status) {
      return res.status(e.status).json({ message: e.message });
    }
    console.error('PATCH /farms/:farmId', e);
    return res.status(500).json({ message: 'No se pudo actualizar la finca.' });
  }
});

router.post(
  '/:farmId/inactivate',
  requireCsrf,
  requireWritePermission,
  async (req, res) => {
    try {
      const farm = await farmsService.inactivateFarm({
        farmId: req.params.farmId,
        clientId: req.user.clientId,
        userId: req.user.id,
      });
      if (!farm) {
        return res.status(404).json({ message: 'Finca no encontrada o ya inactiva.' });
      }
      return res.json(farm);
    } catch (e) {
      if (e.status) {
        return res.status(e.status).json({ message: e.message });
      }
      console.error('POST /farms/:farmId/inactivate', e);
      return res.status(500).json({ message: 'No se pudo inactivar la finca.' });
    }
  }
);

router.post('/:farmId/activate', requireCsrf, requireWritePermission, async (req, res) => {
  try {
    const farm = await farmsService.activateFarm({
      farmId: req.params.farmId,
      clientId: req.user.clientId,
      userId: req.user.id,
    });
    if (!farm) {
      return res.status(404).json({ message: 'Finca no encontrada o ya activa.' });
    }
    return res.json(farm);
  } catch (e) {
    if (e.status) {
      return res.status(e.status).json({ message: e.message });
    }
    console.error('POST /farms/:farmId/activate', e);
    return res.status(500).json({ message: 'No se pudo activar la finca.' });
  }
});

module.exports = router;

