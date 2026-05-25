const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const authRoutes = require('./routes/auth.routes');
const farmsRoutes = require('./routes/farms.routes');
const geoRoutes = require('./routes/geo.routes');
const lotsRoutes = require('./routes/lots.routes');
const workersRoutes = require('./routes/workers.routes');
const laborEntriesRoutes = require('./routes/labor-entries.routes');
const calibersRoutes = require('./routes/calibers.routes');
const avocadoProductionRoutes = require('./routes/avocado-production.routes');
const inventoryItemsRoutes = require('./routes/inventory-items.routes');
const inventoryBrandsRoutes = require('./routes/inventory-brands.routes');
const inventoryMovementsRoutes = require('./routes/inventory-movements.routes');
const inventoryConsumptionsRoutes = require('./routes/inventory-consumptions.routes');
const mixApplicationsRoutes = require('./routes/mix-applications.routes');
const calendarActivitiesRoutes = require('./routes/calendar-activities.routes');
const assetCategoriesRoutes = require('./routes/asset-categories.routes');
const expenseCategoriesRoutes = require('./routes/expense-categories.routes');
const assetsRoutes = require('./routes/assets.routes');
const assetDepreciationRoutes = require('./routes/asset-depreciation.routes');
const expensesRoutes = require('./routes/expenses.routes');
const generalExpensesRoutes = require('./routes/general-expenses.routes');
const generalExpenseAllocationsRoutes = require('./routes/general-expense-allocations.routes');
const payrollNominaContributionRulesRoutes = require('./routes/payroll-nomina-contribution-rules.routes');
const aguinaldosRoutes = require('./routes/aguinaldos.routes');
const payrollSlipsRoutes = require('./routes/payroll-slips.routes');
const tenantUsersRoutes = require('./routes/tenant-users.routes');
const statsRoutes = require('./routes/stats.routes');
const exchangeRateRoutes = require('./routes/exchange-rate.routes');
const superadminRoutes = require('./routes/superadmin.routes');
const { apiPrivateNoStore } = require('./middleware/apiCache.middleware');

const app = express();

if (config.trustProxy) {
  app.set('trust proxy', 1);
}

app.use(helmet());
app.use(
  cors({
    origin:
      Array.isArray(config.corsOrigins) && config.corsOrigins.length > 0
        ? function validateOrigin(origin, callback) {
            // Cuando es request de mismo origen, `origin` suele ser null/undefined.
            if (!origin) return callback(null, true);
            if (config.corsOrigins.includes(origin)) return callback(null, true);
            return callback(null, false);
          }
        : false,
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(apiPrivateNoStore);

/** Límite suave global (login y recuperación tienen limiters propios en auth.routes). */
const globalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.API_RL_MAX_PER_MINUTE || 400),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const p = req.originalUrl || '';
    return p === '/api/health' || p.startsWith('/api/health?');
  },
});
app.use(globalApiLimiter);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api/auth', authRoutes);
app.use('/api/superadmin', superadminRoutes);
app.use('/api/farms', farmsRoutes);
app.use('/api/geo', geoRoutes);
app.use('/api/lots', lotsRoutes);
app.use('/api/workers', workersRoutes);
app.use('/api/labor-entries', laborEntriesRoutes);
app.use('/api/calibers', calibersRoutes);
app.use('/api/avocado-production', avocadoProductionRoutes);
app.use('/api/inventory-items', inventoryItemsRoutes);
app.use('/api/inventory-brands', inventoryBrandsRoutes);
app.use('/api/inventory-movements', inventoryMovementsRoutes);
app.use('/api/inventory-consumptions', inventoryConsumptionsRoutes);
app.use('/api/mix-applications', mixApplicationsRoutes);
app.use('/api/calendar-activities', calendarActivitiesRoutes);
app.use('/api/asset-categories', assetCategoriesRoutes);
app.use('/api/expense-categories', expenseCategoriesRoutes);
app.use('/api/assets', assetsRoutes);
app.use('/api/asset-depreciation', assetDepreciationRoutes);
app.use('/api/expenses', expensesRoutes);
app.use('/api/general-expenses', generalExpensesRoutes);
app.use('/api/general-expense-allocations', generalExpenseAllocationsRoutes);
app.use('/api/payroll-nomina-contribution-rules', payrollNominaContributionRulesRoutes);
app.use('/api/aguinaldos', aguinaldosRoutes);
app.use('/api/payroll-slips', payrollSlipsRoutes);
app.use('/api/tenant-users', tenantUsersRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/exchange-rate', exchangeRateRoutes);

app.use('/api', (req, res) => {
  res.status(404).json({ message: 'No encontrado.' });
});

const publicDir = path.join(__dirname, '..', 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

app.use((err, _req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'JSON inválido.' });
  }
  if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ message: err?.message || 'Solicitud inválida.' });
  }
  console.error(err);
  return res.status(500).json({ message: 'Error interno del servidor.' });
});

module.exports = app;
