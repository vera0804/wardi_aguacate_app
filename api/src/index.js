const app = require('./app');
const { port } = require('./config');
const { startLicenseExpiryCron } = require('./jobs/license-expiry.cron');

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
  startLicenseExpiryCron();
});
