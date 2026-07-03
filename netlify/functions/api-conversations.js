const { json, corsHeaders } = require('../../lib/http');
const { getUserFromRequest } = require('../../lib/auth');
const { getTenantByUserId } = require('../../lib/tenant');
const { getConversations, getThreadMessages } = require('../../lib/inbox');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'GET') return json(405, { error: 'GET seulement' });

  const user = await getUserFromRequest(event);
  if (!user) return json(401, { error: 'Non authentifié' });

  const tenant = await getTenantByUserId(user.id);
  if (!tenant) return json(404, { error: 'Commerce introuvable' });

  const phone = event.queryStringParameters?.phone;
  if (phone) {
    const thread = await getThreadMessages(tenant.id, phone);
    return json(200, { conversation: thread });
  }

  const conversations = await getConversations(tenant.id);
  return json(200, { conversations });
};
