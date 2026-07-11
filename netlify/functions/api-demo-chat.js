/**
 * Chat démo public — Salon Éclat (sans auth).
 * Utilisé par le simulateur dashboard ?demo=1 et le testeur chatbot démo.
 */
const { json, parseJson, corsHeaders } = require('../../lib/http');
const { generateReply } = require('../../lib/ai');
const { checkRateLimit, clientIp } = require('../../lib/rate-limit');
const salonDemo = require('../../dossiers/salon-demo.json');

function fallbackReply(message) {
  const t = String(message || '').toLowerCase();
  if (/prix|combien|co[uû]t|\$/.test(t)) {
    return 'Coupe femme à partir de 45 $, coupe homme à partir de 30 $, balayage à partir de 120 $. Voulez-vous réserver? https://exemple-saloneclat.ca/reservation';
  }
  if (/ouvert|horaire|demain|samedi/.test(t)) {
    return 'Oui! Demain on est ouverts 9 h – 18 h (fermé lundi et dimanche). Réservez ici : https://exemple-saloneclat.ca/reservation';
  }
  if (/rendez|rdv|r[eé]serv/.test(t)) {
    return 'Parfait! Le plus simple : https://exemple-saloneclat.ca/reservation — ou donnez-moi un jour qui vous arrange et l\'équipe confirmera.';
  }
  if (/o[uù]|adress|situ|l[eé]vis/.test(t)) {
    return 'On est au 245, rue Principale à Lévis. Stationnement gratuit derrière le salon.';
  }
  return 'Avec plaisir! Je peux vous aider pour les prix, horaires ou un rendez-vous. Que cherchez-vous?';
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST seulement' });

  const body = parseJson(event);
  const message = (body.message || body.question || '').trim();
  const history = Array.isArray(body.history) ? body.history.slice(-10) : [];

  if (!message || message.length > 600) return json(400, { error: 'Message invalide' });

  const ip = clientIp(event);
  const rl = await checkRateLimit(`demo-chat:${ip}`, { maxAttempts: 40, windowMinutes: 60 });
  if (!rl.ok) return json(429, { error: 'Trop de messages — réessayez plus tard.' });

  try {
    const reply = await generateReply(salonDemo, history, message, null);
    return json(200, {
      reply: reply || fallbackReply(message),
      demo: true,
      business: 'Salon Éclat',
      agent: 'Léa',
    });
  } catch (e) {
    console.error('api-demo-chat', e.message);
    return json(200, { reply: fallbackReply(message), demo: true });
  }
};
