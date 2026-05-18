/**
 * Envío de correos vía Resend (https://resend.com/docs/api-reference/emails/send-email).
 * Requiere RESEND_API_KEY y MAIL_FROM (dominio verificado en Resend).
 */

const fs = require('fs');
const path = require('path');

const RESEND_API = 'https://api.resend.com/emails';

/** CID para logo incrustado (adjunto inline); debe coincidir con `content_id` en el JSON de Resend. */
const EMAIL_LOGO_CID = 'wardi-email-logo';

/**
 * Logo del correo como adjunto inline (no depende de URL pública ni de FRONTEND_URL alcanzable desde Gmail).
 * @returns {{ logoBlockHtml: string, attachments: Array<{ filename: string, content: string, content_type: string, content_id: string }> }}
 */
function getEmailLogoHeaderHtmlAndAttachments() {
  const envPath = process.env.EMAIL_LOGO_PATH && String(process.env.EMAIL_LOGO_PATH).trim();
  // Desde api/src/services: ../../../ = raíz del repo → pwa/public/images/logo.png (Vite public/)
  const candidates = [
    envPath,
    path.join(__dirname, '../../../pwa/public/images/logo.png'),
    path.join(__dirname, '../../../pwa/public/images/logo.jpg'),
    path.join(__dirname, '../../../pwa/public/images/logo.png'),
    path.join(__dirname, '../assets/email-logo.png'),
    path.join(__dirname, '../assets/email-logo.png'),
    path.join(__dirname, '../assets/email-logo.jpg'),
  ].filter(Boolean);

  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const buf = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const contentType =
        ext === '.png'
          ? 'image/png'
          : ext === '.jpg' || ext === '.jpeg'
            ? 'image/jpeg'
            : 'image/jpeg';
      const filename = `logo${ext || '.jpg'}`;
      return {
        logoBlockHtml: `<img src="cid:${EMAIL_LOGO_CID}" alt="Wardi Aguacate" width="140" height="auto" style="display:block;margin:0 auto 24px;max-width:140px;height:auto;border:0;"/>`,
        attachments: [
          {
            filename,
            content: buf.toString('base64'),
            content_type: contentType,
            content_id: EMAIL_LOGO_CID,
          },
        ],
      };
    } catch {
      continue;
    }
  }

  return {
    logoBlockHtml:
      '<div style="font-size:22px;font-weight:700;color:#65a30c;margin:0 auto 24px;text-align:center;">Wardi Aguacate</div>',
    attachments: [],
  };
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function requireResend() {
  const key = process.env.RESEND_API_KEY && String(process.env.RESEND_API_KEY).trim();
  if (!key) {
    const err = new Error(
      'No está configurado RESEND_API_KEY en el servidor; no se puede enviar el correo de recuperación.'
    );
    err.status = 500;
    throw err;
  }
  const from = process.env.MAIL_FROM && String(process.env.MAIL_FROM).trim();
  if (!from) {
    const err = new Error(
      'No está configurado MAIL_FROM en el servidor (remitente verificado en Resend).'
    );
    err.status = 500;
    throw err;
  }
  return { key, from };
}

/**
 * @param {{ to: string, resetLink: string, firstName?: string }} opts
 */
async function sendPasswordResetEmail({ to, resetLink, firstName }) {
  const { key, from } = requireResend();
  const { logoBlockHtml, attachments } = getEmailLogoHeaderHtmlAndAttachments();
  const name = firstName ? escapeHtml(String(firstName).trim()) : '';
  const greeting = name ? `Hola ${name},` : 'Hola,';

  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background-color:#f4f4f0;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f0;padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;border:1px solid #e7e5e4;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
          <tr>
            <td style="padding:32px 28px 28px;text-align:center;">
              ${logoBlockHtml}
              <h1 style="margin:0 0 22px;font-size:22px;line-height:1.25;color:#14532d;font-weight:700;">Recuperación de contraseña</h1>
              <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#44403c;text-align:left;">${greeting}</p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.55;color:#44403c;text-align:left;">
                Recibimos una solicitud para restablecer la contraseña de tu cuenta en <strong style="color:#365314;">Wardi Aguacate</strong>.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
                <tr>
                  <td align="center" style="border-radius:10px;background:#65a30c;">
                    <a href="${escapeHtml(resetLink)}" target="_blank" rel="noopener noreferrer"
                       style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">
                      Reestablecer contraseña
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#57534e;text-align:left;">
                Este enlace vence en <strong style="color:#14532d;">2 horas</strong>. Si no solicitaste el cambio, puedes ignorar este mensaje.
              </p>
              <p style="margin:16px 0 0;font-size:12px;line-height:1.45;color:#78716c;text-align:left;">
                Si el botón no funciona en tu cliente de correo, copia y pega esta dirección en el navegador:<br/>
                <span style="word-break:break-all;color:#57534e;">${escapeHtml(resetLink)}</span>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();

  const res = await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: 'Recuperación de contraseña — Wardi Aguacate',
      html,
      ...(attachments.length ? { attachments } : {}),
    }),
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const detail = data?.message || data?.error || text || res.statusText;
    const err = new Error(`Resend no pudo enviar el correo: ${detail}`);
    err.status = 502;
    throw err;
  }
  return data;
}

module.exports = {
  sendPasswordResetEmail,
};
