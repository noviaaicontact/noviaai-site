// Admin — liste et statut des prospects pubs (marketing_leads).
const { json, parseJson, corsHeaders } = require('../../lib/http');
const { getAdmin } = require('../../lib/db');
const { checkAdminAccess, isAdminConfigured } = require('../../lib/admin-auth');
const { STATUSES, STATUS_LABELS, SOURCE_LABELS, INBOUND_LABELS } = require('../../lib/marketing-lead');

function summarize(rows) {
  const list = rows || [];
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return {
    total: list.length,
    new: list.filter((r) => r.status === 'new').length,
    this_week: list.filter((r) => r.created_at && new Date(r.created_at).getTime() >= weekAgo).length,
    facebook: list.filter((r) => r.source_channel === 'facebook').length,
    instagram: list.filter((r) => r.source_channel === 'instagram').length,
    tiktok: list.filter((r) => r.source_channel === 'tiktok').length,
    meta_ads: list.filter((r) => r.source_channel === 'meta_ads').length,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  if (!isAdminConfigured()) {
    return json(503, { error: 'Admin non configuré — définissez ADMIN_EMAIL dans Netlify.' });
  }

  const access = await checkAdminAccess(event);
  if (!access.ok) return json(401, { error: 'Non autorisé' });

  const db = getAdmin();
  if (!db) return json(503, { error: 'Base de données non configurée' });

  if (event.httpMethod === 'GET') {
    const { data, error } = await db
      .from('marketing_leads')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(300);
    if (error) {
      console.error('admin marketing_leads list', error.message);
      return json(500, { error: 'Chargement impossible' });
    }
    return json(200, {
      leads: data || [],
      summary: summarize(data),
      labels: { status: STATUS_LABELS, source: SOURCE_LABELS, inbound: INBOUND_LABELS },
    });
  }

  if (event.httpMethod === 'PATCH') {
    const body = parseJson(event);
    const id = String(body.id || '').trim();
    const status = String(body.status || '').trim();
    if (!id) return json(400, { error: 'id requis' });
    if (!STATUSES.includes(status)) return json(400, { error: 'Statut invalide' });

    const { data, error } = await db
      .from('marketing_leads')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    if (error) {
      console.error('admin marketing_leads patch', error.message);
      return json(500, { error: 'Mise à jour impossible' });
    }
    return json(200, { ok: true, lead: data });
  }

  return json(405, { error: 'GET ou PATCH seulement' });
};
