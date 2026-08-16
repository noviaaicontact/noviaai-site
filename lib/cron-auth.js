/**
 * Auth des jobs internes (relances SMS, fin d'essai).
 * Toute invocation HTTP exige CRON_SECRET ou INTERNAL_JOB_SECRET.
 * X-NF-Event / User-Agent Clockwork ne sont jamais une authentification.
 *
 * Planificateur Netlify : body JSON { next_run } (ISO-8601), sans notre header.
 * On attache alors le secret depuis l'env — le secret doit exister, sinon refus.
 */

function cronSecret() {
  return String(process.env.CRON_SECRET || process.env.INTERNAL_JOB_SECRET || '').trim();
}

function header(event, name) {
  const h = (event && event.headers) || {};
  return h[name] || h[name.toLowerCase()] || h[name.toUpperCase()] || '';
}

function providedSecret(event) {
  const fromHeader = header(event, 'x-cron-secret') || header(event, 'X-Cron-Secret');
  if (fromHeader) return String(fromHeader).trim();
  const auth = header(event, 'authorization') || header(event, 'Authorization');
  const m = String(auth).match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  const qs = (event && event.queryStringParameters) || {};
  return String(qs.secret || qs.cron_secret || '').trim();
}

function isNetlifySchedulerEvent(event) {
  const ev = String(
    header(event, 'x-nf-event')
    || header(event, 'X-NF-Event')
    || header(event, 'x-netlify-event')
    || header(event, 'X-Netlify-Event'),
  ).toLowerCase();
  if (ev !== 'schedule') return false;
  const ua = String(header(event, 'user-agent') || header(event, 'User-Agent'));
  return /netlify clockwork/i.test(ua);
}

function parseSchedulerNextRun(event) {
  const raw = event && event.body;
  if (raw == null || raw === '') return null;
  let data;
  try {
    data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const keys = Object.keys(data);
  if (keys.length !== 1 || keys[0] !== 'next_run') return null;
  if (!Number.isFinite(Date.parse(data.next_run))) return null;
  return String(data.next_run);
}

/**
 * Clockwork n'envoie pas X-Cron-Secret. Si le body est exactement { next_run },
 * on copie le secret d'environnement dans l'événement (le secret doit être défini).
 */
function withCronSecret(event) {
  const secret = cronSecret();
  const src = event || {};
  if (!secret) return src;
  if (providedSecret(src)) return src;
  if (!parseSchedulerNextRun(src)) return src;
  return {
    ...src,
    headers: { ...(src.headers || {}), 'x-cron-secret': secret },
  };
}

function authorizeCron(event) {
  const secret = cronSecret();
  if (!secret) return false;
  const got = providedSecret(event);
  return !!(got && got === secret);
}

function cronUnauthorized() {
  return {
    statusCode: 401,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'Non autorisé' }),
  };
}

module.exports = {
  cronSecret,
  providedSecret,
  isNetlifySchedulerEvent,
  parseSchedulerNextRun,
  withCronSecret,
  authorizeCron,
  cronUnauthorized,
};
