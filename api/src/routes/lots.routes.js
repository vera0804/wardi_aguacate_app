const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireCsrf } = require('../middleware/csrf.middleware');
const { requireRoles, requireEffectiveClient, requireWritePermission } = require('../middleware/roles.middleware');
const lotsService = require('../services/lots.service');

const router = express.Router();

router.use(requireAuth, requireRoles(['admin', 'operario', 'superadmin']), requireEffectiveClient);

router.get('/', async (req, res) => {
  const includeInactive =
    String(req.query.include_inactive || req.query.includeInactive || '').toLowerCase() === 'true';
  const farmId = req.query.farm_id ? String(req.query.farm_id) : undefined;
  try {
    const rows = await lotsService.listLots({
      clientId: req.user.clientId,
      farmId,
      includeInactive,
    });
    return res.json(rows);
  } catch (e) {
    console.error('GET /lots', e);
    return res.status(500).json({ message: 'No se pudieron cargar los lotes.' });
  }
});

router.get('/meta', async (req, res) => {
  try {
    const [farms, varieties] = await Promise.all([
      lotsService.listActiveFarmsForLots({ clientId: req.user.clientId }),
      lotsService.listActiveVarieties(),
    ]);
    return res.json({ farms, varieties });
  } catch (e) {
    console.error('GET /lots/meta', e);
    return res.status(500).json({ message: 'No se pudo cargar la información del formulario.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const lot = await lotsService.getLotById({
      lotId: req.params.id,
      clientId: req.user.clientId,
    });
    if (!lot) {
      return res.status(404).json({ message: 'Lote no encontrado.' });
    }
    return res.json(lot);
  } catch (e) {
    console.error('GET /lots/:id', e);
    return res.status(500).json({ message: 'No se pudo cargar el lote.' });
  }
});

router.post('/', requireCsrf, requireWritePermission, async (req, res) => {
  try {
    const lot = await lotsService.createLot({
      clientId: req.user.clientId,
      userId: req.user.id,
      farmId: req.body?.farm_id,
      name: req.body?.name,
      areaHa: req.body?.area_ha,
      plantCount: req.body?.plant_count,
      varietyIds: req.body?.variety_ids,
    });
    return res.status(201).json(lot);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    console.error('POST /lots', e);
    return res.status(500).json({ message: 'No se pudo crear el lote.' });
  }
});

router.patch('/:id', requireCsrf, requireWritePermission, async (req, res) => {
  try {
    const lot = await lotsService.updateLot({
      lotId: req.params.id,
      clientId: req.user.clientId,
      userId: req.user.id,
      farmId: req.body?.farm_id,
      name: req.body?.name,
      areaHa: req.body?.area_ha,
      plantCount: req.body?.plant_count,
      varietyIds: req.body?.variety_ids,
    });
    if (!lot) {
      return res.status(404).json({ message: 'Lote no encontrado.' });
    }
    return res.json(lot);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    console.error('PATCH /lots/:id', e);
    return res.status(500).json({ message: 'No se pudo actualizar el lote.' });
  }
});

router.patch('/:id/active', requireCsrf, requireWritePermission, async (req, res) => {
  const hasIsActive = Object.prototype.hasOwnProperty.call(req.body || {}, 'is_active');
  if (!hasIsActive || typeof req.body.is_active !== 'boolean') {
    return res.status(400).json({ message: 'is_active debe ser booleano.' });
  }
  try {
    const lot = await lotsService.setLotActive({
      lotId: req.params.id,
      clientId: req.user.clientId,
      userId: req.user.id,
      isActive: req.body.is_active,
    });
    if (!lot) {
      return res.status(404).json({ message: 'Lote no encontrado.' });
    }
    return res.json(lot);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    console.error('PATCH /lots/:id/active', e);
    return res.status(500).json({ message: 'No se pudo actualizar el estado del lote.' });
  }
});

module.exports = router;

