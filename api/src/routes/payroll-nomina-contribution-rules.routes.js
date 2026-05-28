const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireCsrf } = require('../middleware/csrf.middleware');
const { requireRoles, requireEffectiveClient, requireWritePermission } = require('../middleware/roles.middleware');
const service = require('../services/payroll-nomina-contribution-rules.service');

const router = express.Router();

router.use(requireAuth, requireRoles(['admin', 'superadmin']), requireEffectiveClient);

router.get('/', async (req, res, next) => {
  try {
    let active = undefined;
    if (req.query.active !== undefined && String(req.query.active).trim() !== '') {
      active = service.parseActiveQuery(req.query.active);
      if (active === 'all') active = undefined;
    }
    const rows = await service.listNominaContributionRules({
      clientId: req.user.clientId,
      active,
    });
    return res.json(rows);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

router.post('/', requireCsrf, requireWritePermission, async (req, res, next) => {
  try {
    const employerCcssPct =
      req.body?.employer_ccss_pct_of_gross ?? req.body?.employer_pct_of_gross;
    const row = await service.createNominaContributionRule({
      clientId: req.user.clientId,
      userId: req.user.id,
      validFrom: req.body?.valid_from,
      validTo: req.body?.valid_to,
      employerCcssPctOfGross: employerCcssPct,
      employerOtherPctOfGross: req.body?.employer_other_pct_of_gross,
      employeePctOfGross: req.body?.employee_pct_of_gross,
      notes: req.body?.notes,
    });
    return res.status(201).json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

router.patch('/:id/deactivate', requireCsrf, requireWritePermission, async (req, res, next) => {
  try {
    const row = await service.deactivateNominaContributionRule({
      id: req.params.id,
      clientId: req.user.clientId,
      userId: req.user.id,
    });
    if (!row) {
      return res.status(404).json({
        message: 'Regla no encontrada o ya estaba inactiva.',
      });
    }
    return res.json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

module.exports = router;
