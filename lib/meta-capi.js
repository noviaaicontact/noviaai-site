// Meta Conversions API — Lead serveur (dédupliqué avec le pixel via event_id).
const crypto = require('crypto');

const PIXEL_ID = process.env.META_PIXEL_ID || '1422965575850124';
const API = 'https://graph.facebook.com/v21.0';

function sha256(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return null;
  return crypto.createHash('sha256').update(s).digest('hex');
}

function digitsPhone(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 10) return `1${d}`;
  return d;
}

function cookieVal(cookieHeader, name) {
  if (!cookieHeader) return '';
  const re = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`);
  const m = String(cookieHeader).match(re);
  return m ? decodeURIComponent(m[1]) : '';
}

function buildFbc(fbclid, existing) {
  if (existing) return existing;
  if (!fbclid) return '';
  return `fb.1.${Date.now()}.${fbclid}`;
}

/**
 * @param {{
 *   email?: string, phone?: string, firstName?: string,
 *   eventId?: string, eventSourceUrl?: string,
 *   fbp?: string, fbc?: string, fbclid?: string,
 *   ip?: string, ua?: string, campaign?: string,
 *   cookieHeader?: string,
 * }} opts
 */
async function sendMetaLead(opts) {
  const token = process.env.META_CAPI_TOKEN || process.env.META_ADS_TOKEN;
  if (!token) return { skipped: true, reason: 'no_token' };

  const fbp = opts.fbp || cookieVal(opts.cookieHeader, '_fbp');
  const fbc = buildFbc(opts.fbclid, opts.fbc || cookieVal(opts.cookieHeader, '_fbc'));

  const user_data = {};
  const em = sha256(opts.email);
  const ph = sha256(digitsPhone(opts.phone));
  const fn = sha256(opts.firstName);
  if (em) user_data.em = [em];
  if (ph) user_data.ph = [ph];
  if (fn) user_data.fn = [fn];
  if (fbp) user_data.fbp = fbp;
  if (fbc) user_data.fbc = fbc;
  if (opts.ip) user_data.client_ip_address = opts.ip;
  if (opts.ua) user_data.client_user_agent = opts.ua;

  const event = {
    event_name: 'Lead',
    event_time: Math.floor(Date.now() / 1000),
    action_source: 'website',
    event_source_url: opts.eventSourceUrl || 'https://noviaai.ca/potentiel',
    user_data,
    custom_data: {
      content_name: opts.campaign || 'decouvrir',
      content_category: 'qualification',
    },
  };
  if (opts.eventId) event.event_id = opts.eventId;

  const body = { data: [event] };
  const testCode = String(process.env.META_CAPI_TEST_EVENT_CODE || '').trim();
  if (testCode) body.test_event_code = testCode;

  const url = `${API}/${PIXEL_ID}/events?access_token=${encodeURIComponent(token)}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) {
      console.error('meta-capi', json.error?.message || `http_${res.status}`);
      return { ok: false };
    }
    return { ok: true, events_received: json.events_received };
  } catch (e) {
    console.error('meta-capi', e.message);
    return { ok: false };
  }
}

module.exports = { sendMetaLead, sha256, digitsPhone, buildFbc };
