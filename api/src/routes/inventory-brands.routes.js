const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireCsrf } = require('../middleware/csrf.middleware');
const { requireRoles, requireEffectiveClient, requireWritePermission } = require('../middleware/roles.middleware');
const brandsService = require('../services/inventory-brands.service');

const router = express.Router();

router.use(requireAuth, requireRoles(['admin', 'operario', 'superadmin']), requireEffectiveClient);

router.get('/', async (req, res) => {
  try {
    const rows = await brandsService.listInventoryBrands({
      clientId: req.user.clientId,
      active: req.query.active,
      search: req.query.search,
    });
    return res.json(rows);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    console.error('GET /inventory-brands', e);
    return res.status(500).json({ message: 'No se pudieron cargar las marcas.' });
  }
});

router.post('/', requireCsrf, requireWritePermission, async (req, res) => {
  try {
    const row = await brandsService.createInventoryBrand({
      clientId: req.user.clientId,
      userId: req.user.id,
      name: req.body?.name,
    });
    return res.status(201).json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    if (e.code === '23505') return res.status(409).json({ message: 'Ya existe una marca con ese nombre.' });
    console.error('POST /inventory-brands', e);
    return res.status(500).json({ message: 'No se pudo crear la marca.' });
  }
});

router.patch('/:id', requireCsrf, requireWritePermission, async (req, res) => {
  try {
    const row = await brandsService.updateInventoryBrand({
      clientId: req.user.clientId,
      id: req.params.id,
      userId: req.user.id,
      name: req.body?.name,
    });
    if (!row) return res.status(404).json({ message: 'Marca no encontrada.' });
    return res.json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    if (e.code === '23505') return res.status(409).json({ message: 'Ya existe una marca con ese nombre.' });
    console.error('PATCH /inventory-brands/:id', e);
    return res.status(500).json({ message: 'No se pudo actualizar la marca.' });
  }
});

router.patch('/:id/active', requireCsrf, requireWritePermission, async (req, res) => {
  const hasIsActive = Object.prototype.hasOwnProperty.call(req.body || {}, 'is_active');
  if (!hasIsActive || typeof req.body.is_active !== 'boolean') {
    return res.status(400).json({ message: 'is_active debe ser booleano.' });
  }
  try {
    const row = await brandsService.setInventoryBrandActive({
      clientId: req.user.clientId,
      id: req.params.id,
      userId: req.user.id,
      isActive: req.body.is_active,
    });
    if (!row) return res.status(404).json({ message: 'Marca no encontrada.' });
    return res.json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    console.error('PATCH /inventory-brands/:id/active', e);
    return res.status(500).json({ message: 'No se pudo actualizar estado de la marca.' });
  }
});

module.exports = router;

