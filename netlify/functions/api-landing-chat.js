const { json, parseJson, corsHeaders } = require('../../lib/http');
const { generateLandingReply } = require('../../lib/landing-chat');
const { checkRateLimit, clientIp } = require('../../lib/rate-limit');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST seulement' });

  const body = parseJson(event);
  const message = (body.message || '').trim();
  const history = Array.isArray(body.history) ? body.history : [];

  if (!message || message.length > 600) return json(400, { error: 'Message invalide' });

  const ip = clientIp(event);
  const rl = await checkRateLimit(`landing-chat:${ip}`, { maxAttempts: 40, windowMinutes: 60 });
  if (!rl.ok) return json(429, { error: 'Trop de messages — réessayez plus tard.' });

  const reply = await generateLandingReply(history, message);
  return json(200, { reply });
};
