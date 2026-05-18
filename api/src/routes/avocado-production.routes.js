const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireCsrf } = require('../middleware/csrf.middleware');
const { requireRoles, requireEffectiveClient, requireWritePermission } = require('../middleware/roles.middleware');
const productionService = require('../services/avocado-production.service');

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
    const data = await productionService.getMeta({ clientId: req.user.clientId });
    return res.json(data);
  } catch (e) {
    console.error('GET /avocado-production/meta', e);
    return res.status(500).json({ message: 'No se pudo cargar metadata de producci?n.' });
  }
});

router.get('/summary/lot', async (req, res) => {
  try {
    const rows = await productionService.getSummaryByLot({
      clientId: req.user.clientId,
      fromDate: req.query.from_date,
      toDate: req.query.to_date,
      farmId: req.query.farm_id,
      lotId: req.query.lot_id,
    });
    return res.json(rows);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    console.error('GET /avocado-production/summary/lot', e);
    return res.status(500).json({ message: 'No se pudo generar resumen por lote.' });
  }
});

router.get('/', async (req, res) => {
  try {
    const rows = await productionService.listProductions({
      clientId: req.user.clientId,
      filters: {
        fromDate: req.query.from_date,
        toDate: req.query.to_date,
        scope: req.query.cost_scope,
        farmId: req.query.farm_id,
        lotId: req.query.lot_id,
        active: parseActive(req.query.active),
      },
    });
    return res.json(rows);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    console.error('GET /avocado-production', e);
    return res.status(500).json({ message: 'No se pudo listar producci?n.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const row = await productionService.getProductionById({
      id: req.params.id,
      clientId: req.user.clientId,
    });
    if (!row) return res.status(404).json({ message: 'Registro de producci?n no encontrado.' });
    return res.json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    console.error('GET /avocado-production/:id', e);
    return res.status(500).json({ message: 'No se pudo cargar la producci?n.' });
  }
});

router.post('/', requireCsrf, requireWritePermission, async (req, res) => {
  try {
    const row = await productionService.createProduction({
      clientId: req.user.clientId,
      userId: req.user.id,
      payload: req.body || {},
    });
    return res.status(201).json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    if (e.code === '23505') return res.status(409).json({ message: 'Conflicto de unicidad en producci?n.' });
    console.error('POST /avocado-production', e);
    return res.status(500).json({ message: 'No se pudo crear producci?n.' });
  }
});

router.post('/bulk', requireCsrf, requireWritePermission, async (req, res) => {
  try {
    const rows = await productionService.createProductionsBulk({
      clientId: req.user.clientId,
      userId: req.user.id,
      payload: req.body || {},
    });
    return res.status(201).json(rows);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    if (e.code === '23505') return res.status(409).json({ message: 'Conflicto de unicidad en rango.' });
    console.error('POST /avocado-production/bulk', e);
    return res.status(500).json({ message: 'No se pudo crear producci?n por rango.' });
  }
});

router.patch('/:id', requireCsrf, requireWritePermission, async (req, res) => {
  try {
    const row = await productionService.updateProduction({
      id: req.params.id,
      clientId: req.user.clientId,
      userId: req.user.id,
      payload: req.body || {},
    });
    if (!row) return res.status(404).json({ message: 'Registro de producci?n no encontrado.' });
    return res.json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    if (e.code === '23505') return res.status(409).json({ message: 'Conflicto de unicidad en edici?n.' });
    console.error('PATCH /avocado-production/:id', e);
    return res.status(500).json({ message: 'No se pudo actualizar producci?n.' });
  }
});

router.patch('/:id/active', requireCsrf, requireWritePermission, async (req, res) => {
  const hasIsActive = Object.prototype.hasOwnProperty.call(req.body || {}, 'is_active');
  if (!hasIsActive || typeof req.body.is_active !== 'boolean') {
    return res.status(400).json({ message: 'is_active debe ser booleano.' });
  }
  try {
    const row = await productionService.setProductionActive({
      id: req.params.id,
      clientId: req.user.clientId,
      userId: req.user.id,
      isActive: req.body.is_active,
    });
    if (!row) return res.status(404).json({ message: 'Registro de producci?n no encontrado.' });
    return res.json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    if (e.code === '23505') return res.status(409).json({ message: 'Conflicto al cambiar estado.' });
    if (e.code === '23514') {
      return res.status(409).json({
        message:
          'El registro tiene datos inconsistentes para su scope (finca/lote). Edita el registro y vuelve a intentar.',
      });
    }
    console.error('PATCH /avocado-production/:id/active', {
      code: e?.code,
      message: e?.message,
    });
    return res.status(500).json({ message: 'No se pudo actualizar estado de producci?n.' });
  }
});

module.exports = router;

