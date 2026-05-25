const cron = require('node-cron');
const clientLicenseService = require('../services/client-license.service');

let scheduledTask = null;

function isCronEnabled() {
  return process.env.LICENSE_CRON_ENABLED !== '0';
}

function startLicenseExpiryCron() {
  if (!isCronEnabled()) {
    console.log('[license-cron] desactivado (LICENSE_CRON_ENABLED=0)');
    return null;
  }

  const schedule = process.env.LICENSE_CRON_SCHEDULE || '59 23 * * *';
  const timezone = clientLicenseService.getLicenseTimezone();

  if (!cron.validate(schedule)) {
    console.error(`[license-cron] expresión cron inválida: ${schedule}`);
    return null;
  }

  scheduledTask = cron.schedule(
    schedule,
    async () => {
      try {
        const result = await clientLicenseService.processLicenseExpiryForToday();
        if (result.expiredCount > 0) {
          console.log(
            `[license-cron] ${result.expiredCount} cliente(s) vencidos; ${result.sessionsRevoked} sesión(es) revocadas (${result.today})`
          );
        }
      } catch (e) {
        console.error('[license-cron] error en job', e);
      }
    },
    { timezone }
  );

  console.log(`[license-cron] programado "${schedule}" (${timezone})`);
  return scheduledTask;
}

module.exports = {
  startLicenseExpiryCron,
  registerLicenseExpiryCron: startLicenseExpiryCron,
  isCronEnabled,
};
