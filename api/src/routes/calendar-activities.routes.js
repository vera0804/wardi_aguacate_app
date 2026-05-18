const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireCsrf } = require('../middleware/csrf.middleware');
const { requireRoles, requireEffectiveClient, requireWritePermission } = require('../middleware/roles.middleware');
const calendarActivitiesService = require('../services/calendar-activities.service');

const router = express.Router();

router.use(requireAuth, requireRoles(['admin', 'operario', 'superadmin']), requireEffectiveClient);

router.get('/', async (req, res, next) => {
  try {
    const rows = await calendarActivitiesService.listCalendarActivities({
      clientId: req.user.clientId,
      farmId: req.query.farm_id || undefined,
      fromDate: req.query.from || req.query.from_date,
      toDate: req.query.to || req.query.to_date,
      lotId: req.query.lot_id || undefined,
      laborTypeId: req.query.labor_type_id || undefined,
      status: req.query.status || undefined,
    });
    return res.json(rows);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await calendarActivitiesService.getCalendarActivityById({
      id: req.params.id,
      clientId: req.user.clientId,
    });
    if (!row) return res.status(404).json({ message: 'Actividad no encontrada.' });
    return res.json(row);
  } catch (e) {
    next(e);
  }
});

router.post('/', requireCsrf, requireWritePermission, async (req, res, next) => {
  try {
    const result = await calendarActivitiesService.createCalendarActivity({
      clientId: req.user.clientId,
      userId: req.user.id,
      body: req.body || {},
    });
    return res.status(201).json(result);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

router.patch('/:id', requireCsrf, requireWritePermission, async (req, res, next) => {
  try {
    const result = await calendarActivitiesService.updateCalendarActivity({
      id: req.params.id,
      clientId: req.user.clientId,
      userId: req.user.id,
      body: req.body || {},
    });
    if (!result) return res.status(404).json({ message: 'Actividad no encontrada.' });
    return res.json(result);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
});

module.exports = router;
