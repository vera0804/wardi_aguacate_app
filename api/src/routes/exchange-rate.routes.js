const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireRoles } = require('../middleware/roles.middleware');
const bccrExchange = require('../services/bccr-exchange.service');

const router = express.Router();

router.use(requireAuth, requireRoles(['admin', 'operario', 'superadmin']));

/**
 * GET /api/exchange-rate/usd?date=YYYY-MM-DD&kind=compra|venta
 * Referencia BCCR (USD). Requiere sesión.
 */
router.get('/usd', async (req, res, next) => {
  try {
    const date = req.query.date;
    const kindRaw = req.query.kind;
    const kind = kindRaw === 'compra' ? 'compra' : 'venta';
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      return res.status(400).json({ message: 'Parámetro date obligatorio (YYYY-MM-DD).' });
    }
    const data = await bccrExchange.getUsdExchangeRate({
      date: String(date).slice(0, 10),
      kind,
    });
    return res.json(data);
  } catch (e) {
    const status = Number(e.status);
    if (status === 400 || status === 500 || status === 503) {
      return res.status(status).json({ message: e.message });
    }
    next(e);
  }
});

module.exports = router;
