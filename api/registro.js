// POST /api/registro — recibe el formulario de /inversion y lo envía por mail con Resend.
// Variables de entorno (Vercel → Settings → Environment Variables):
//   RESEND_API_KEY  (obligatoria)  clave de Resend
//   RESEND_FROM     (opcional)     remitente; por defecto "PAIX <alo@paix.ar>" (el dominio debe estar verificado en Resend)
//   REGISTRO_TO     (opcional)     destino, por defecto inversion@paix.ar

const TO_DEFAULT = 'inversion@paix.ar';
const FROM_DEFAULT = 'PAIX <alo@paix.ar>'; // el dominio paix.ar debe estar verificado en Resend
const MAX = { nombre: 120, organizacion: 160, email: 160, pais: 80, tipo: 80, tamano: 80, mensaje: 4000 };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max) : '');
const json = (res, status, body) => { res.status(status).setHeader('Cache-Control', 'no-store'); res.json(body); };

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { ok: false, error: 'method_not_allowed' }); }

  // Solo desde el propio sitio
  const origin = req.headers.origin;
  if (origin) {
    let host = '';
    try { host = new URL(origin).host; } catch (e) { /* origen inválido */ }
    if (!host || host !== req.headers.host) return json(res, 403, { ok: false, error: 'forbidden' });
  }

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
  if (!b || typeof b !== 'object') return json(res, 400, { ok: false, error: 'bad_request' });

  // Honeypot: los bots completan este campo, las personas no. Respondemos "ok" para no darles pistas.
  if (b._honey) return json(res, 200, { ok: true });

  const d = {};
  for (const k of Object.keys(MAX)) d[k] = clean(b[k], MAX[k]);
  const idioma = b.idioma === 'EN' ? 'EN' : 'ES';
  if (!d.nombre || !d.organizacion || !d.pais || !d.tipo) return json(res, 400, { ok: false, error: 'missing_fields' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) return json(res, 400, { ok: false, error: 'invalid_email' });
  if (b.consent !== true) return json(res, 400, { ok: false, error: 'consent_required' });

  const key = process.env.RESEND_API_KEY;
  if (!key) return json(res, 500, { ok: false, error: 'not_configured' });

  const rows = [
    ['Nombre y apellido', d.nombre], ['Organización', d.organizacion], ['Email', d.email], ['País', d.pais],
    ['Tipo de organización', d.tipo], ['Tamaño', d.tamano || '—'], ['Idioma de la página', idioma],
    ['Mensaje', d.mensaje || '—'], ['Aviso legal', 'Aceptado (paix.ar/inversion, Ley 25.326)'],
  ];
  const html = '<h2 style="font-family:system-ui,sans-serif">Nuevo registro de interés · PAIX</h2>' +
    '<table style="font-family:system-ui,sans-serif;font-size:14px;border-collapse:collapse">' +
    rows.map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#555;vertical-align:top"><b>${esc(k)}</b></td><td style="padding:6px 0;white-space:pre-wrap">${esc(v)}</td></tr>`).join('') + '</table>';
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n');

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || FROM_DEFAULT,
        to: [process.env.REGISTRO_TO || TO_DEFAULT],
        reply_to: d.email,
        subject: `PAIX · Registro de interés — ${d.organizacion}`.replace(/[\r\n]+/g, ' '),
        html, text,
      }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('Resend rechazó el envío', r.status, detail.slice(0, 500));
      return json(res, 502, { ok: false, error: 'mail_failed' });
    }
    return json(res, 200, { ok: true });
  } catch (err) {
    console.error('Error al llamar a Resend', err);
    return json(res, 502, { ok: false, error: 'mail_failed' });
  }
};
