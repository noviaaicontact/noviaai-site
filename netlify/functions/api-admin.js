const { json, parseJson, corsHeaders } = require('../../lib/http');
const { getAdmin } = require('../../lib/db');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST seulement' });

  const secret = event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'];
  if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) {
    return json(403, { error: 'Accès refusé' });
  }

  const { tenant_id, twilio_number } = parseJson(event);
  if (!tenant_id || !twilio_number) {
    return json(400, { error: 'tenant_id et twilio_number requis' });
  }

  const db = getAdmin();
  const { data, error } = await db.from('tenants').update({ twilio_number }).eq('id', tenant_id).select('*').single();
  if (error) return json(500, { error: error.message });
  return json(200, { tenant: data });
};
