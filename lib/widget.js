const crypto = require('crypto');
const { getAdmin, isDbConfigured } = require('./db');

function webCallerId(sessionId) {
  const id = String(sessionId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  return id ? `web:${id}` : '';
}

async function getTenantByWidgetId(widgetId) {
  if (!widgetId || !isDbConfigured()) return null;
  const db = getAdmin();
  const { data } = await db
    .from('tenants')
    .select('*')
    .eq('widget_public_id', widgetId)
    .maybeSingle();
  if (!data || data.widget_enabled === false) return null;
  if (data.provisioning_status !== 'active' || !data.twilio_number) return null;
  return data;
}

async function ensureWidgetPublicId(tenant) {
  if (!tenant || !tenant.id) return null;
  if (tenant.widget_public_id) return tenant.widget_public_id;
  if (!isDbConfigured()) return null;
  const id = crypto.randomUUID();
  const db = getAdmin();
  const { error } = await db
    .from('tenants')
    .update({ widget_public_id: id, updated_at: new Date().toISOString() })
    .eq('id', tenant.id);
  if (error) {
    console.error('ensureWidgetPublicId', error.message);
    return null;
  }
  return id;
}

function widgetEmbedSnippet(widgetId, baseUrl) {
  const base = (baseUrl || 'https://noviaai.ca').replace(/\/$/, '');
  return `<script src="${base}/widget.js?v=2" data-widget-id="${widgetId}" async></script>`;
}

module.exports = {
  webCallerId,
  getTenantByWidgetId,
  ensureWidgetPublicId,
  widgetEmbedSnippet,
};
