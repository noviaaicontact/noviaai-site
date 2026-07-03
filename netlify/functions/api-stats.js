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
  const since = new Date(Date.now() - 30 * 86400000).toISOString();

  const [msgs, missed, leads] = await Promise.all([
    db.from('sms_messages').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).gte('created_at', since),
    db.from('missed_calls').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).gte('created_at', since),
    db.from('leads').select('*').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(20),
  ]);

  const msgCount = msgs.count || 0;
  const missedCount = missed.count || 0;
  const leadCount = tenant.leads_count || (leads.data || []).length;
  const avg = parseFloat(tenant.avg_client_value) || 75;
  const roiLow = Math.round(leadCount * avg * 0.3);
  const roiHigh = Math.round(leadCount * avg);

  return json(200, {
    messages_30d: msgCount,
    missed_calls_30d: missedCount,
    leads_total: leadCount,
    roi_estimated: { low: roiLow, high: roiHigh, avg_client_value: avg },
    leads: leads.data || [],
    provisioning_status: tenant.provisioning_status,
    twilio_number: tenant.twilio_number,
  });
};
