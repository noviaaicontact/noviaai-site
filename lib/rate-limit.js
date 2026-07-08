const { getAdmin, isDbConfigured } = require('./db');

async function checkRateLimit(bucket, { maxAttempts = 10, windowMinutes = 60 } = {}) {
  if (!bucket || !isDbConfigured()) return { ok: true };
  const db = getAdmin();
  const since = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
  const { count, error } = await db
    .from('rate_limits')
    .select('*', { count: 'exact', head: true })
    .eq('bucket', bucket)
    .gte('created_at', since);
  if (error) {
    console.warn('rate-limit check', error.message);
    return { ok: true };
  }
  if ((count || 0) >= maxAttempts) {
    return { ok: false, retryAfterMinutes: windowMinutes };
  }
  await db.from('rate_limits').insert({ bucket });
  return { ok: true };
}

function clientIp(event) {
  return (
    event.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || event.headers['client-ip']
    || event.headers['x-nf-client-connection-ip']
    || 'unknown'
  );
}

module.exports = { checkRateLimit, clientIp };
