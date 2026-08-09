const { json, corsHeaders } = require('../../lib/http');
const { resolveTenantContext } = require('../../lib/tenant-context');
const { getConversations, getThreadMessages } = require('../../lib/inbox');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'GET') return json(405, { error: 'GET seulement' });

  const ctx = await resolveTenantContext(event);
  if (!ctx.ok) return ctx.response;
  const tenant = ctx.tenant;

  const phone = event.queryStringParameters?.phone;
  if (phone) {
    const thread = await getThreadMessages(tenant.id, phone);
    return json(200, { conversation: thread });
  }

  const conversations = await getConversations(tenant.id);
  return json(200, { conversations });
};
