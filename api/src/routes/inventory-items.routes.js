const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireCsrf } = require('../middleware/csrf.middleware');
const { requireRoles, requireEffectiveClient, requireWritePermission } = require('../middleware/roles.middleware');
const itemsService = require('../services/inventory-items.service');

const router = express.Router();

router.use(requireAuth, requireRoles(['admin', 'operario', 'superadmin']), requireEffectiveClient);

router.get('/meta', async (req, res) => {
  try {
    const data = await itemsService.getInventoryItemsMeta({ clientId: req.user.clientId });
    return res.json(data);
  } catch (e) {
    console.error('GET /inventory-items/meta', e);
    const status =
      Number.isInteger(e?.status) && e.status >= 400 && e.status < 600 ? e.status : 500;
    return res.status(status).json({
      message: e?.message || 'No se pudo cargar metadata de insumos.',
    });
  }
});

router.get('/', async (req, res) => {
  try {
    const rows = await itemsService.listInventoryItems({
      clientId: req.user.clientId,
      active: req.query.active,
      categoryId: req.query.category_id,
      search: req.query.search,
    });
    return res.json(rows);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    console.error('GET /inventory-items', e);
    return res.status(500).json({ message: 'No se pudieron cargar los insumos.' });
  }
});

router.post('/', requireCsrf, requireWritePermission, async (req, res) => {
  try {
    const row = await itemsService.createInventoryItem({
      clientId: req.user.clientId,
      userId: req.user.id,
      name: req.body?.name,
      unit: req.body?.unit,
      categoryId: req.body?.category_id,
      brandId: req.body?.brand_id,
      brandName: req.body?.brand_name,
    });
    return res.status(201).json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    if (e.code === '23505') {
      return res.status(409).json({ message: 'Ya existe un insumo con ese nombre, unidad y fabricante.' });
    }
    console.error('POST /inventory-items', e);
    return res.status(500).json({ message: 'No se pudo crear el insumo.' });
  }
});

router.patch('/:id', requireCsrf, requireWritePermission, async (req, res) => {
  try {
    const row = await itemsService.updateInventoryItem({
      clientId: req.user.clientId,
      userId: req.user.id,
      id: req.params.id,
      name: req.body?.name,
      unit: req.body?.unit,
      categoryId: req.body?.category_id,
      brandId: req.body?.brand_id,
      brandName: req.body?.brand_name,
    });
    if (!row) return res.status(404).json({ message: 'Insumo no encontrado.' });
    return res.json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    if (e.code === '23505') {
      return res.status(409).json({ message: 'Ya existe un insumo con ese nombre, unidad y fabricante.' });
    }
    console.error('PATCH /inventory-items/:id', e);
    return res.status(500).json({ message: 'No se pudo actualizar el insumo.' });
  }
});

router.patch('/:id/active', requireCsrf, requireWritePermission, async (req, res) => {
  const hasIsActive = Object.prototype.hasOwnProperty.call(req.body || {}, 'is_active');
  if (!hasIsActive || typeof req.body.is_active !== 'boolean') {
    return res.status(400).json({ message: 'is_active debe ser booleano.' });
  }
  try {
    const row = await itemsService.setInventoryItemActive({
      clientId: req.user.clientId,
      userId: req.user.id,
      id: req.params.id,
      isActive: req.body.is_active,
    });
    if (!row) return res.status(404).json({ message: 'Insumo no encontrado.' });
    return res.json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    console.error('PATCH /inventory-items/:id/active', e);
    return res.status(500).json({ message: 'No se pudo actualizar estado del insumo.' });
  }
});

module.exports = router;

