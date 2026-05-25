#!/usr/bin/env node
/**
 * Copia pwa/dist → api/public para despliegue único (API + PWA en un solo proceso).
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'pwa', 'dist');
const dest = path.join(__dirname, '..', 'api', 'public');

if (!fs.existsSync(src)) {
  console.error('No existe pwa/dist. Ejecuta antes: npm run build --prefix pwa');
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log('✓ PWA copiada a api/public');
