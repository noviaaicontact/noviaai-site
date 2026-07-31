// Petits utilitaires partagés par les fonctions Twilio.

function parseBody(event) {
  let body = event.body || '';
  if (event.isBase64Encoded) body = Buffer.from(body, 'base64').toString('utf8');
  return new URLSearchParams(body);
}

function paramsToObject(params) {
  const out = {};
  params.forEach((value, key) => { out[key] = value; });
  return out;
}

function webhookUrl(event) {
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const path = event.path || event.rawPath || '';
  let url;
  if (base) {
    url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  } else {
    const host = event.headers['x-forwarded-host'] || event.headers.host || '';
    const proto = event.headers['x-forwarded-proto'] || 'https';
    url = `${proto}://${host}${path.startsWith('/') ? path : `/${path}`}`;
  }
  const rawQuery = event.rawQuery;
  if (rawQuery) {
    url += `?${rawQuery}`;
  } else if (event.queryStringParameters && Object.keys(event.queryStringParameters).length) {
    url += `?${new URLSearchParams(event.queryStringParameters).toString()}`;
  }
  return url;
}

/** Variantes d'URL : Twilio / Netlify divergent parfois (slash final, www, path). */
function webhookUrlCandidates(event) {
  const primary = webhookUrl(event);
  const urls = new Set([primary]);
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (base) {
    urls.add(`${base}/.netlify/functions/sms`);
    urls.add(`${base}/.netlify/functions/sms/`);
    urls.add(`${base}/.netlify/functions/voice`);
    urls.add(`${base}/.netlify/functions/voice/`);
    if (base.includes('://noviaai.ca')) {
      urls.add(base.replace('://noviaai.ca', '://www.noviaai.ca') + '/.netlify/functions/sms');
      urls.add(base.replace('://noviaai.ca', '://www.noviaai.ca') + '/.netlify/functions/sms/');
    }
  }
  const host = event.headers && (event.headers['x-forwarded-host'] || event.headers.host);
  const proto = (event.headers && event.headers['x-forwarded-proto']) || 'https';
  if (host) {
    const path = event.path || event.rawPath || '/.netlify/functions/sms';
    const p = path.startsWith('/') ? path : `/${path}`;
    urls.add(`${proto}://${host}${p}`);
    urls.add(`${proto}://${host}${p.replace(/\/$/, '')}`);
    urls.add(`${proto}://${host}${p.endsWith('/') ? p : `${p}/`}`);
  }
  // Avec / sans slash final pour chaque candidat
  for (const u of [...urls]) {
    if (u.endsWith('/')) urls.add(u.slice(0, -1));
    else urls.add(`${u}/`);
  }
  return [...urls];
}

function validateTwilioRequest(event) {
  if (process.env.TWILIO_SKIP_SIGNATURE === 'true') return true;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return process.env.NODE_ENV !== 'production';
  const signature = event.headers['x-twilio-signature'] || event.headers['X-Twilio-Signature'];
  if (!signature) {
    console.warn('twilio signature missing');
    return false;
  }
  try {
    const twilio = require('twilio');
    const params = paramsToObject(parseBody(event));
    const urls = webhookUrlCandidates(event);
    const ok = urls.some((url) => {
      try {
        return twilio.validateRequest(authToken, signature, url, params);
      } catch {
        return false;
      }
    });
    if (!ok) {
      console.warn('twilio signature reject', {
        path: event.path || event.rawPath,
        host: event.headers && (event.headers['x-forwarded-host'] || event.headers.host),
        tried: urls.slice(0, 8),
      });
    }
    return ok;
  } catch (e) {
    console.error('twilio validate', e.message);
    return false;
  }
}

function twilioUnauthorized() {
  return { statusCode: 403, headers: { 'Content-Type': 'text/plain' }, body: 'Forbidden' };
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  }[c]));
}

function twimlMessage(msg) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(msg)}</Message></Response>`;
}

function xmlResponse(body) {
  return { statusCode: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' }, body };
}

// Clé de conversation stable et sûre (basée sur les 2 numéros).
function convoKey(businessNumber, callerNumber) {
  return (String(businessNumber) + '__' + String(callerNumber)).replace(/[^a-zA-Z0-9_]/g, '');
}

module.exports = {
  parseBody, paramsToObject, webhookUrl, validateTwilioRequest, twilioUnauthorized,
  escapeXml, twimlMessage, xmlResponse, convoKey,
};
