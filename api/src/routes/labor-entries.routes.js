const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireCsrf } = require('../middleware/csrf.middleware');
const { requireRoles, requireEffectiveClient, requireWritePermission } = require('../middleware/roles.middleware');
const laborEntriesService = require('../services/labor-entries.service');

const router = express.Router();

function parseActive(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v || v === 'all') return undefined;
  if (v === 'true') return true;
  if (v === 'false') return false;
  const err = new Error('El filtro active debe ser true, false o all.');
  err.status = 400;
  throw err;
}

router.use(requireAuth, requireRoles(['admin', 'operario', 'superadmin']), requireEffectiveClient);

router.get('/meta', async (req, res) => {
  try {
    const data = await laborEntriesService.getMeta({ clientId: req.user.clientId });
    return res.json(data);
  } catch (e) {
    console.error('GET /labor-entries/meta', e);
    return res.status(500).json({ message: 'No se pudo cargar metadata de labores.' });
  }
});

router.get('/summary/lot', async (req, res) => {
  try {
    const rows = await laborEntriesService.getSummaryByLot({
      clientId: req.user.clientId,
      fromDate: req.query.from_date,
      toDate: req.query.to_date,
      farmId: req.query.farm_id,
      lotId: req.query.lot_id,
    });
    return res.json(rows);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    console.error('GET /labor-entries/summary/lot', e);
    return res.status(500).json({ message: 'No se pudo generar resumen por lote.' });
  }
});

router.get('/summary/worker', async (req, res) => {
  try {
    const rows = await laborEntriesService.getSummaryByWorker({
      clientId: req.user.clientId,
      fromDate: req.query.from_date,
      toDate: req.query.to_date,
      workerId: req.query.worker_id,
    });
    return res.json(rows);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    console.error('GET /labor-entries/summary/worker', e);
    return res.status(500).json({ message: 'No se pudo generar resumen por trabajador.' });
  }
});

router.get('/', async (req, res) => {
  try {
    const rows = await laborEntriesService.listLaborEntries({
      clientId: req.user.clientId,
      filters: {
        fromDate: req.query.from_date,
        toDate: req.query.to_date,
        scope: req.query.cost_scope,
        farmId: req.query.farm_id,
        lotId: req.query.lot_id,
        workerId: req.query.worker_id,
        active: parseActive(req.query.active),
      },
    });
    return res.json(rows);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    console.error('GET /labor-entries', e);
    return res.status(500).json({ message: 'No se pudieron cargar los registros de labor.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const row = await laborEntriesService.getLaborEntryById({
      id: req.params.id,
      clientId: req.user.clientId,
    });
    if (!row) {
      return res.status(404).json({ message: 'Registro de labor no encontrado.' });
    }
    return res.json(row);
  } catch (e) {
    console.error('GET /labor-entries/:id', e);
    return res.status(500).json({ message: 'No se pudo cargar el registro de labor.' });
  }
});

router.post('/', requireCsrf, requireWritePermission, async (req, res) => {
  try {
    const row = await laborEntriesService.createLaborEntry({
      clientId: req.user.clientId,
      userId: req.user.id,
      payload: req.body || {},
    });
    return res.status(201).json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    if (e.code === '23505') {
      return res.status(409).json({ message: 'Conflicto de unicidad en registro de labor.' });
    }
    console.error('POST /labor-entries', e);
    return res.status(500).json({ message: 'No se pudo crear el registro de labor.' });
  }
});

router.post('/bulk', requireCsrf, requireWritePermission, async (req, res) => {
  try {
    const rows = await laborEntriesService.createLaborEntriesBulk({
      clientId: req.user.clientId,
      userId: req.user.id,
      payload: req.body || {},
    });
    return res.status(201).json(rows);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    if (e.code === '23505') {
      return res.status(409).json({ message: 'Conflicto de unicidad en carga masiva.' });
    }
    console.error('POST /labor-entries/bulk', e);
    return res.status(500).json({ message: 'No se pudo crear la carga masiva de labores.' });
  }
});

router.patch('/:id', requireCsrf, requireWritePermission, async (req, res) => {
  try {
    const row = await laborEntriesService.updateLaborEntry({
      id: req.params.id,
      clientId: req.user.clientId,
      userId: req.user.id,
      payload: req.body || {},
    });
    if (!row) {
      return res.status(404).json({ message: 'Registro de labor no encontrado.' });
    }
    return res.json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    if (e.code === '23505') {
      return res.status(409).json({ message: 'Conflicto de unicidad en edición de labor.' });
    }
    console.error('PATCH /labor-entries/:id', e);
    return res.status(500).json({ message: 'No se pudo actualizar el registro de labor.' });
  }
});

router.patch('/:id/active', requireCsrf, requireWritePermission, async (req, res) => {
  const hasIsActive = Object.prototype.hasOwnProperty.call(req.body || {}, 'is_active');
  if (!hasIsActive || typeof req.body.is_active !== 'boolean') {
    return res.status(400).json({ message: 'is_active debe ser booleano.' });
  }
  try {
    const row = await laborEntriesService.setLaborEntryActive({
      id: req.params.id,
      clientId: req.user.clientId,
      userId: req.user.id,
      isActive: req.body.is_active,
    });
    if (!row) {
      return res.status(404).json({ message: 'Registro de labor no encontrado.' });
    }
    return res.json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    if (e.code === '23505') {
      return res.status(409).json({ message: 'Conflicto al reactivar/inactivar registro.' });
    }
    console.error('PATCH /labor-entries/:id/active', e);
    return res.status(500).json({ message: 'No se pudo actualizar el estado del registro de labor.' });
  }
});

module.exports = router;

