const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireCsrf } = require('../middleware/csrf.middleware');
const { requireRoles, requireEffectiveClient, requireWritePermission } = require('../middleware/roles.middleware');
const workersService = require('../services/workers.service');

const router = express.Router();

router.use(requireAuth, requireRoles(['admin', 'operario', 'superadmin']), requireEffectiveClient);

router.get('/', async (req, res) => {
  try {
    const rows = await workersService.listWorkers({
      clientId: req.user.clientId,
      active: req.query.active,
      type: req.query.type,
      search: req.query.search,
    });
    return res.json(rows);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    console.error('GET /workers', e);
    return res.status(500).json({ message: 'No se pudieron cargar los trabajadores.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const row = await workersService.getWorkerById({
      workerId: req.params.id,
      clientId: req.user.clientId,
    });
    if (!row) {
      return res.status(404).json({ message: 'Trabajador no encontrado.' });
    }
    return res.json(row);
  } catch (e) {
    console.error('GET /workers/:id', e);
    return res.status(500).json({ message: 'No se pudo cargar el trabajador.' });
  }
});

router.post('/', requireCsrf, requireWritePermission, async (req, res) => {
  try {
    const row = await workersService.createWorker({
      clientId: req.user.clientId,
      userId: req.user.id,
      workerType: req.body?.worker_type,
      firstName: req.body?.first_name,
      lastName1: req.body?.last_name_1,
      lastName2: req.body?.last_name_2,
      idType: req.body?.id_type,
      idNumber: req.body?.id_number,
      phone: req.body?.phone,
      notes: req.body?.notes,
    });
    return res.status(201).json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    if (e.code === '23505') {
      return res.status(409).json({
        message: 'Ya existe un trabajador con ese tipo y número de identificación.',
      });
    }
    console.error('POST /workers', e);
    return res.status(500).json({ message: 'No se pudo crear el trabajador.' });
  }
});

router.patch('/:id', requireAuth, requireCsrf, requireWritePermission, async (req, res) => {
  try {
    const row = await workersService.updateWorker({
      clientId: req.user.clientId,
      workerId: req.params.id,
      userId: req.user.id,
      workerType: req.body?.worker_type,
      firstName: req.body?.first_name,
      lastName1: req.body?.last_name_1,
      lastName2: req.body?.last_name_2,
      idType: req.body?.id_type,
      idNumber: req.body?.id_number,
      phone: req.body?.phone,
      notes: req.body?.notes,
    });
    if (!row) {
      return res.status(404).json({ message: 'Trabajador no encontrado.' });
    }
    return res.json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    if (e.code === '23505') {
      return res.status(409).json({
        message: 'Ya existe un trabajador con ese tipo y número de identificación.',
      });
    }
    console.error('PATCH /workers/:id', e);
    return res.status(500).json({ message: 'No se pudo actualizar el trabajador.' });
  }
});

router.patch('/:id/active', requireCsrf, requireWritePermission, async (req, res) => {
  const hasIsActive = Object.prototype.hasOwnProperty.call(req.body || {}, 'is_active');
  if (!hasIsActive || typeof req.body.is_active !== 'boolean') {
    return res.status(400).json({ message: 'is_active debe ser booleano.' });
  }

  try {
    const row = await workersService.setWorkerActive({
      workerId: req.params.id,
      clientId: req.user.clientId,
      userId: req.user.id,
      isActive: req.body.is_active,
    });
    if (!row) {
      return res.status(404).json({ message: 'Trabajador no encontrado.' });
    }
    return res.json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    console.error('PATCH /workers/:id/active', e);
    return res.status(500).json({ message: 'No se pudo actualizar el estado del trabajador.' });
  }
});

module.exports = router;

