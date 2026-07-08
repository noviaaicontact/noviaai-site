const { json, corsHeaders } = require('../../lib/http');
const { getTenantByWidgetId } = require('../../lib/widget');
const { rowToDossier } = require('../../lib/dossier-builder');
const { formatDisplay } = require('../../lib/phone-util');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'GET') return json(405, { error: 'GET seulement' });

  const widgetId = (event.queryStringParameters && event.queryStringParameters.id) || '';
  if (!widgetId) return json(400, { error: 'ID widget requis' });

  const tenant = await getTenantByWidgetId(widgetId);
  if (!tenant) return json(404, { error: 'Widget introuvable ou inactif' });

  const dossier = rowToDossier(tenant);
  const welcome = tenant.welcome_sms
    || (dossier.scripts && dossier.scripts.accueil)
    || `Bonjour! Ici ${tenant.agent_name || 'Léa'}, de ${tenant.business_name}. Comment puis-je vous aider?`;

  const digits = String(tenant.twilio_number || '').replace(/\D/g, '');
  const smsHref = digits ? `sms:+${digits.length === 10 ? '1' + digits : digits}` : null;

  return json(200, {
    business_name: tenant.business_name,
    agent_name: tenant.agent_name || 'Léa',
    welcome_message: welcome,
    phone_display: formatDisplay(tenant.twilio_number),
    sms_href: smsHref,
  });
};
