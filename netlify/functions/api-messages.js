const { json, corsHeaders } = require('../../lib/http');
const { getUserFromRequest } = require('../../lib/auth');
const { getTenantByUserId } = require('../../lib/tenant');
const { getAdmin } = require('../../lib/db');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'GET') return json(405, { error: 'GET seulement' });

  const user = await getUserFromRequest(event);
  if (!user) return json(401, { error: 'Non authentifié' });

  const tenant = await getTenantByUserId(user.id);
  if (!tenant) return json(404, { error: 'Commerce introuvable' });

  const db = getAdmin();
  const limit = Math.min(parseInt(event.queryStringParameters?.limit || '50', 10), 200);

  const [msgs, missed] = await Promise.all([
    db.from('sms_messages').select('*').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(limit),
    db.from('missed_calls').select('*').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(20),
  ]);

  return json(200, {
    messages: msgs.data || [],
    missed_calls: missed.data || [],
  });
};
