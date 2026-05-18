const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireCsrf } = require('../middleware/csrf.middleware');
const { requireRoles, requireEffectiveClient, requireWritePermission } = require('../middleware/roles.middleware');
const consumptionsService = require('../services/inventory-consumptions.service');

const router = express.Router();

router.use(requireAuth, requireRoles(['admin', 'operario', 'superadmin']), requireEffectiveClient);

router.get('/', async (req, res, next) => {
  try {
    const rows = await consumptionsService.listInventoryConsumptions({
      clientId: req.user.clientId,
      active: req.query.active,
      lotId: req.query.lot_id || undefined,
      farmId: req.query.farm_id || undefined,
      itemId: req.query.item_id || undefined,
      expenseId: req.query.expense_id || undefined,
      harvestId: req.query.harvest_id || undefined,
      fromDate: req.query.from_date || undefined,
      toDate: req.query.to_date || undefined,
    });
    return res.json(rows);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

router.post('/', requireCsrf, requireWritePermission, async (req, res, next) => {
  try {
    const result = await consumptionsService.createDirectConsumption({
      clientId: req.user.clientId,
      userId: req.user.id,
      cost_scope: req.body?.cost_scope,
      lot_id: req.body?.lot_id,
      farm_id: req.body?.farm_id,
      allocations: req.body?.allocations,
      item_id: req.body?.item_id,
      cons_date: req.body?.cons_date,
      qty: req.body?.qty,
      notes: req.body?.notes,
    });
    return res.status(201).json(result);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

router.patch('/:id/active', requireCsrf, requireWritePermission, async (req, res, next) => {
  const hasIsActive = Object.prototype.hasOwnProperty.call(req.body || {}, 'is_active');
  if (!hasIsActive || req.body.is_active !== false) {
    return res.status(400).json({ message: 'Solo se permite inactivar el consumo (is_active: false).' });
  }
  try {
    const row = await consumptionsService.deactivateInventoryConsumption({
      clientId: req.user.clientId,
      userId: req.user.id,
      id: req.params.id,
    });
    if (!row) return res.status(404).json({ message: 'Consumo no encontrado.' });
    return res.json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await consumptionsService.getInventoryConsumptionById({
      clientId: req.user.clientId,
      id: req.params.id,
    });
    if (!row) return res.status(404).json({ message: 'Consumo no encontrado.' });
    return res.json(row);
  } catch (e) {
    next(e);
  }
});

router.patch('/:id', requireCsrf, requireWritePermission, async (req, res, next) => {
  try {
    const row = await consumptionsService.updateInventoryConsumption({
      clientId: req.user.clientId,
      userId: req.user.id,
      id: req.params.id,
      body: req.body || {},
    });
    if (!row) return res.status(404).json({ message: 'Consumo no encontrado.' });
    return res.json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

module.exports = router;
