const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireRoles, requireEffectiveClient } = require('../middleware/roles.middleware');
const statsService = require('../services/stats.service');

const router = express.Router();

router.get(
  '/overview',
  requireAuth,
  requireRoles(['admin', 'superadmin']),
  requireEffectiveClient,
  async (req, res, next) => {
    try {
      const data = await statsService.getOverview({
        ...req.query,
        clientId: req.user.clientId,
      });
      return res.json(data);
    } catch (e) {
      if (e.status) return res.status(e.status).json({ message: e.message });
      next(e);
    }
  }
);

module.exports = router;
