const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireCsrf } = require('../middleware/csrf.middleware');
const { requireRoles, requireEffectiveClient, requireWritePermission } = require('../middleware/roles.middleware');
const service = require('../services/aguinaldo-statements.service');

const router = express.Router();

const AG_STATUSES = new Set(['calculado', 'pagado', 'cancelado']);

function parseAguinaldoStatusList(queryStatus) {
  if (queryStatus === undefined || queryStatus === null) {
    return ['calculado', 'pagado'];
  }
  const s = String(queryStatus).trim().toLowerCase();
  if (s === '' || s === 'all') return null;
  const parts = s.split(/[,|]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  for (const p of parts) {
    if (!AG_STATUSES.has(p)) {
      const err = new Error('status inválido. Use calculado, pagado, cancelado, all o lista separada por coma.');
      err.status = 400;
      throw err;
    }
  }
  return parts;
}

router.use(requireAuth, requireRoles(['admin', 'superadmin']), requireEffectiveClient);

router.get('/', async (req, res, next) => {
  try {
    let statusList;
    try {
      statusList = parseAguinaldoStatusList(req.query.status);
    } catch (e) {
      if (e.status) return res.status(e.status).json({ message: e.message });
      throw e;
    }
    const rows = await service.listAguinaldoStatements({
      clientId: req.user.clientId,
      workerId: req.query.worker_id || undefined,
      statusList,
      periodFrom: req.query.period_from || undefined,
      periodTo: req.query.period_to || undefined,
    });
    return res.json(rows);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

router.post('/calculate', requireCsrf, requireWritePermission, async (req, res, next) => {
  try {
    const row = await service.calculateAguinaldoStatement({
      clientId: req.user.clientId,
      userId: req.user.id,
      workerId: req.body?.worker_id,
      legalNovYear: req.body?.legal_nov_year,
    });
    return res.status(201).json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

router.post('/:id/recalculate', requireCsrf, requireWritePermission, async (req, res, next) => {
  try {
    const row = await service.recalculateAguinaldoStatement({
      id: req.params.id,
      clientId: req.user.clientId,
      userId: req.user.id,
    });
    return res.json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await service.getAguinaldoStatementById({
      id: req.params.id,
      clientId: req.user.clientId,
    });
    if (!row) {
      return res.status(404).json({ message: 'Registro no encontrado.' });
    }
    return res.json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

router.patch('/:id/status', requireCsrf, requireWritePermission, async (req, res, next) => {
  try {
    const row = await service.updateAguinaldoStatementStatus({
      id: req.params.id,
      clientId: req.user.clientId,
      userId: req.user.id,
      status: req.body?.status,
    });
    return res.json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

module.exports = router;
