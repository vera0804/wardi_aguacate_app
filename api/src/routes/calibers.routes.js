const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireCsrf } = require('../middleware/csrf.middleware');
const { requireRoles, requireEffectiveClient, requireWritePermission } = require('../middleware/roles.middleware');
const calibersService = require('../services/calibers.service');

const router = express.Router();

router.use(requireAuth, requireRoles(['admin', 'operario', 'superadmin']), requireEffectiveClient);

router.get('/', async (req, res) => {
  try {
    const includeInactive = String(req.query.include_inactive || '').toLowerCase() === 'true';
    const rows = await calibersService.listCalibers({
      clientId: req.user.clientId,
      includeInactive,
      search: req.query.search,
    });
    return res.json(rows);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    console.error('GET /calibers', e);
    return res.status(500).json({ message: 'No se pudieron cargar los calibres.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const row = await calibersService.getCaliberById({
      id: req.params.id,
      clientId: req.user.clientId,
    });
    if (!row) return res.status(404).json({ message: 'Calibre no encontrado.' });
    return res.json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    console.error('GET /calibers/:id', e);
    return res.status(500).json({ message: 'No se pudo cargar el calibre.' });
  }
});

router.post('/', requireCsrf, requireWritePermission, async (req, res) => {
  try {
    const row = await calibersService.createCaliber({
      clientId: req.user.clientId,
      ...(req.body || {}),
    });
    return res.status(201).json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    console.error('POST /calibers', e);
    return res.status(500).json({ message: 'No se pudo crear el calibre.' });
  }
});

router.patch('/:id', requireCsrf, requireWritePermission, async (req, res) => {
  try {
    const row = await calibersService.updateCaliber({
      id: req.params.id,
      clientId: req.user.clientId,
      ...(req.body || {}),
    });
    if (!row) return res.status(404).json({ message: 'Calibre no encontrado.' });
    return res.json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    console.error('PATCH /calibers/:id', e);
    return res.status(500).json({ message: 'No se pudo actualizar el calibre.' });
  }
});

router.patch('/:id/active', requireCsrf, requireWritePermission, async (req, res) => {
  const hasIsActive = Object.prototype.hasOwnProperty.call(req.body || {}, 'is_active');
  if (!hasIsActive || typeof req.body.is_active !== 'boolean') {
    return res.status(400).json({ message: 'is_active debe ser booleano.' });
  }
  try {
    const row = await calibersService.setCaliberActive({
      id: req.params.id,
      clientId: req.user.clientId,
      isActive: req.body.is_active,
    });
    if (!row) return res.status(404).json({ message: 'Calibre no encontrado.' });
    return res.json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    console.error('PATCH /calibers/:id/active', e);
    return res.status(500).json({ message: 'No se pudo actualizar el estado del calibre.' });
  }
});

module.exports = router;

