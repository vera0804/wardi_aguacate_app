const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireCsrf } = require('../middleware/csrf.middleware');
const { requireRoles, requireEffectiveClient } = require('../middleware/roles.middleware');
const {
  listMovements,
  getMovementById,
  getMovementLayers,
  createMovement,
  createAdjustment,
  updateMovement,
  setMovementActive,
  getStock,
  getItemLayers,
  getMovementsMeta,
} = require('../services/inventory-movements.service');

const router = express.Router();

function requireAdmin(req, res, next) {
  const r = String(req.user?.role || '').toLowerCase();
  if (r === 'superadmin' && req.user?.actingClientId) return next();
  if (r === 'admin') return next();
  return res.status(403).json({ message: 'Solo el administrador puede realizar esta acción.' });
}

router.use(requireAuth, requireRoles(['admin', 'operario', 'superadmin']), requireEffectiveClient);

router.get('/meta', async (req, res, next) => {
  try {
    const data = await getMovementsMeta({ clientId: req.user.clientId });
    res.json(data);
  } catch (e) {
    next(e);
  }
});

router.get('/stock/total', requireAdmin, async (req, res, next) => {
  try {
    const rows = await getStock({ clientId: req.user.clientId });
    const total = rows.reduce((acc, x) => acc + Number(x.stock_value_crc || 0), 0);
    res.json({ total_value_crc: Number(total.toFixed(2)) });
  } catch (e) {
    next(e);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const active =
      req.query.active === undefined
        ? undefined
        : ['1', 'true', 'si', 'yes'].includes(String(req.query.active).toLowerCase());
    const rows = await listMovements({
      clientId: req.user.clientId,
      filters: {
        itemId: req.query.item_id || undefined,
        movement: req.query.movement || undefined,
        fromDate: req.query.from_date || undefined,
        toDate: req.query.to_date || undefined,
        active,
      },
    });
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.get('/stock/list', async (req, res, next) => {
  try {
    const rows = await getStock({ clientId: req.user.clientId, itemId: req.query.item_id || null });
    const role = String(req.user?.role || '').toLowerCase();
    if (role === 'operario') {
      return res.json(
        rows.map((r) => ({
          ...r,
          stock_value_crc: null,
        }))
      );
    }
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.get('/stock/:itemId/layers', async (req, res, next) => {
  try {
    const onlyAvailable = ['1', 'true', 'si', 'yes'].includes(
      String(req.query.available || '').toLowerCase()
    );
    const data = await getItemLayers({
      clientId: req.user.clientId,
      itemId: req.params.itemId,
      onlyAvailable,
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await getMovementById({ id: req.params.id, clientId: req.user.clientId });
    if (!row) return res.status(404).json({ message: 'Movimiento no encontrado.' });
    return res.json(row);
  } catch (e) {
    next(e);
  }
});

router.get('/:id/layers', async (req, res, next) => {
  try {
    const row = await getMovementLayers({ movementId: req.params.id, clientId: req.user.clientId });
    if (!row) return res.status(404).json({ message: 'Movimiento no encontrado.' });
    return res.json(row);
  } catch (e) {
    next(e);
  }
});

router.post('/', requireCsrf, async (req, res, next) => {
  try {
    const row = await createMovement({
      clientId: req.user.clientId,
      userId: req.user.id,
      payload: req.body || {},
      actorRole: req.user.role,
    });
    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
});

router.post('/adjust', requireAdmin, requireCsrf, async (req, res, next) => {
  try {
    const row = await createAdjustment({
      clientId: req.user.clientId,
      userId: req.user.id,
      payload: req.body || {},
      actorRole: req.user.role,
    });
    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
});

router.patch('/:id', requireCsrf, async (req, res, next) => {
  try {
    const row = await updateMovement({
      clientId: req.user.clientId,
      userId: req.user.id,
      id: req.params.id,
      payload: req.body || {},
      actorRole: req.user.role,
    });
    if (!row) return res.status(404).json({ message: 'Movimiento no encontrado.' });
    return res.json(row);
  } catch (e) {
    next(e);
  }
});

router.patch('/:id/active', requireCsrf, async (req, res, next) => {
  const hasIsActive = Object.prototype.hasOwnProperty.call(req.body || {}, 'is_active');
  if (!hasIsActive || typeof req.body.is_active !== 'boolean') {
    return res.status(400).json({ message: 'is_active debe ser booleano.' });
  }
  try {
    const row = await setMovementActive({
      clientId: req.user.clientId,
      userId: req.user.id,
      id: req.params.id,
      isActive: req.body.is_active,
      actorRole: req.user.role,
    });
    if (!row) return res.status(404).json({ message: 'Movimiento no encontrado.' });
    return res.json(row);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
