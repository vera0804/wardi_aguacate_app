const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireCsrf } = require('../middleware/csrf.middleware');
const { requireRoles, requireEffectiveClient } = require('../middleware/roles.middleware');
const generalExpensesService = require('../services/general-expenses.service');
const generalExpenseAllocationsService = require('../services/general-expense-allocations.service');

const router = express.Router();
router.use(requireAuth, requireRoles(['admin', 'operario', 'superadmin']), requireEffectiveClient);

function parseActive(value) {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  return generalExpensesService.parseActiveQuery(value);
}

router.get('/', async (req, res, next) => {
  try {
    const data = await generalExpensesService.listGeneralExpenses({
      clientId: req.user.clientId,
      farmId: req.query.farm_id || undefined,
      category: req.query.category || undefined,
      active: parseActive(req.query.active),
      fromDate: req.query.from || req.query.from_date,
      toDate: req.query.to || req.query.to_date,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    return res.json(data);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

router.get('/:id/allocations', async (req, res, next) => {
  try {
    const rows = await generalExpenseAllocationsService.listAllocations({
      clientId: req.user.clientId,
      generalExpenseId: req.params.id,
    });
    return res.json(rows);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

router.post('/:id/seed-allocations', requireCsrf, async (req, res, next) => {
  try {
    const out = await generalExpensesService.seedAllocations({
      id: req.params.id,
      clientId: req.user.clientId,
    });
    return res.status(201).json(out);
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
    const row = await generalExpensesService.setGeneralExpenseActive({
      id: req.params.id,
      clientId: req.user.clientId,
      userId: req.user.id,
      isActive: req.body.is_active,
    });
    if (!row) return res.status(404).json({ message: 'Gasto general no encontrado.' });
    return res.json(row);
  } catch (e) {
    next(e);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await generalExpensesService.getGeneralExpenseById({
      id: req.params.id,
      clientId: req.user.clientId,
    });
    if (!row) return res.status(404).json({ message: 'Gasto general no encontrado.' });
    return res.json(row);
  } catch (e) {
    next(e);
  }
});

router.patch('/:id', requireCsrf, async (req, res, next) => {
  try {
    const row = await generalExpensesService.updateGeneralExpense({
      id: req.params.id,
      clientId: req.user.clientId,
      userId: req.user.id,
      body: req.body || {},
    });
    if (!row) return res.status(404).json({ message: 'Gasto general no encontrado.' });
    return res.json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

router.post('/', requireCsrf, async (req, res, next) => {
  try {
    const row = await generalExpensesService.createGeneralExpense({
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

module.exports = router;
