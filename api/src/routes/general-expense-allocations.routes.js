const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireCsrf } = require('../middleware/csrf.middleware');
const { requireRoles, requireEffectiveClient } = require('../middleware/roles.middleware');
const allocationsService = require('../services/general-expense-allocations.service');

const router = express.Router();
router.use(requireAuth, requireRoles(['admin', 'operario', 'superadmin']), requireEffectiveClient);

router.get('/', async (req, res, next) => {
  try {
    const rows = await allocationsService.listAllocations({
      clientId: req.user.clientId,
      generalExpenseId: req.query.general_expense_id || undefined,
      lotId: req.query.lot_id || undefined,
    });
    return res.json(rows);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

router.post('/commit', requireCsrf, async (req, res, next) => {
  try {
    const rows = await allocationsService.commitAllocations({
      clientId: req.user.clientId,
      body: req.body || {},
    });
    return res.json(rows);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

router.patch('/:id', requireCsrf, async (req, res, next) => {
  try {
    const row = await allocationsService.patchAllocation({
      id: req.params.id,
      clientId: req.user.clientId,
      body: req.body || {},
    });
    if (!row) return res.status(404).json({ message: 'Asignación no encontrada.' });
    return res.json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

module.exports = router;
