/**
 * L'agent décide si le proprio a vraiment besoin d'un courriel.
 * Oui = job payante, soumission, ou client mécontent.
 * Non = horaire, adresse, analyse d'eau, chit-chat.
 */

const { resolveBookingAction } = require('./service-workflows');
const { isTestCaller } = require('./phone-util');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const TRIVIAL_RE = /^(allo|allô|salut|bonjour|bonsoir|hey|hi|ok|oui|non|merci|thanks|parfait|d['']accord)\s*[!.]*$/i;

function isTrivialInbound(message) {
  const t = String(message || '').trim();
  if (!t) return true;
  if (t.length <= 2) return true;
  return TRIVIAL_RE.test(t);
}

function parseOwnerNotifyDecision(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  let jsonText = text;
  const fence = text.match(/\{[\s\S]*\}/);
  if (fence) jsonText = fence[0];
  try {
    const data = JSON.parse(jsonText);
    const notify = data.notify === true || data.notify === 'true';
    const kind = ['lead', 'appointment', 'complaint', 'human'].includes(data.kind)
      ? data.kind
      : (notify ? 'lead' : null);
    return {
      notify,
      kind: notify ? kind : null,
      why: String(data.why || '').slice(0, 200),
    };
  } catch {
    return null;
  }
}

function servicesHint(services) {
  if (!Array.isArray(services) || !services.length) return '(aucun service listé)';
  return services.slice(0, 20).map((s) => {
    const nom = s && s.nom ? s.nom : '';
    if (!nom) return '';
    const ping = s.notify_owner === false ? 'PAS de courriel proprio' : 'courriel si vrai dossier';
    return `- ${nom} [${ping}]`;
  }).filter(Boolean).join('\n');
}

function heuristicOwnerNotify({ tenant, userMessage, qualificationData, intent, complete }) {
  const booking = resolveBookingAction({
    services: tenant && tenant.services,
    userMessage,
    qualificationData,
    calendarConnected: false,
    reservationLinks: tenant && tenant.reservation_links,
    reservationUrl: tenant && tenant.reservation_url,
    tenant,
  });
  const optedOut = !!(booking.service && booking.service.notify_owner === false);
  const payingService = !!(booking.matched && !optedOut);
  const reason = intent && intent.reason;
  const must = reason === 'complaint' || reason === 'human';
  const commercial = !!(intent && intent.type && intent.type !== 'human_transfer') || complete;
  const callbackWithJob = reason === 'callback' && payingService;
  const notify = !!(must || callbackWithJob || (commercial && !optedOut));
  const kind = reason === 'complaint'
    ? 'complaint'
    : (must
      ? 'human'
      : (intent && intent.type) || (complete ? 'lead' : null));
  return { notify, kind: notify ? kind : null, why: 'heuristic' };
}

function sourceFromDecision(decision, intent, workflow) {
  if (decision && decision.kind === 'complaint') return { source: 'human_transfer', reason: 'complaint' };
  if (decision && decision.kind === 'human') return { source: 'human_transfer', reason: null };
  if (decision && decision.kind === 'appointment') return { source: 'appointment', reason: null };
  if (decision && decision.kind === 'lead') return { source: 'lead', reason: null };
  if (intent && intent.type) {
    return { source: intent.type, reason: intent.reason || null };
  }
  return { source: workflow === 'appointment' ? 'appointment' : 'lead', reason: null };
}

async function decideOwnerNotify({
  tenant,
  callerPhone,
  userMessage,
  aiReply,
  qualificationData,
  intent,
  complete,
}) {
  if (!tenant || isTestCaller(callerPhone)) {
    return { notify: false, kind: null, why: 'skip' };
  }
  if (isTrivialInbound(userMessage)) {
    return { notify: false, kind: null, why: 'trivial' };
  }

  const fallback = heuristicOwnerNotify({
    tenant, userMessage, qualificationData, intent, complete,
  });

  const key = process.env.OPENAI_API_KEY;
  if (!key) return fallback;

  const biz = (tenant.business_name || 'le commerce').slice(0, 80);
  const prompt = `Tu décides si le propriétaire de « ${biz} » doit recevoir un courriel MAINTENANT.

OUI seulement si le client :
- veut une job / un achat qui rapporte (soumission, fermeture, ouverture, install, réparation, spa, piscine, thermopompe, devis), OU
- est mécontent, fâché, parle de plainte, d'avis Google, de remboursement, ou exige un humain.

NON si :
- horaire, adresse, stationnement, « vous êtes ouverts? »
- analyse d'eau gratuite, produits chimiques à aller chercher en magasin
- politesse, merci, allô, question FAQ que l'agente a déjà réglée
- « rappelez-moi » juste pour une info (horaire), sans job payante ni plainte

Services du commerce :
${servicesHint(tenant.services)}

Client: ${String(userMessage || '').slice(0, 400)}
Agent: ${String(aiReply || '').slice(0, 400)}

Réponds UNIQUEMENT un JSON : {"notify":true|false,"kind":"lead"|"appointment"|"complaint"|"human"|null,"why":"5 mots"}`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: 'Tu es un filtre d\'alertes pour un commerce. JSON strict, pas de markdown.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 80,
        temperature: 0,
      }),
    });
    if (!res.ok) {
      console.warn('owner-notify http', res.status);
      return fallback;
    }
    const data = await res.json();
    const raw = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    const parsed = parseOwnerNotifyDecision(raw);
    if (!parsed) return fallback;
    return parsed;
  } catch (e) {
    console.warn('owner-notify', e.message);
    return fallback;
  }
}

module.exports = {
  isTrivialInbound,
  parseOwnerNotifyDecision,
  heuristicOwnerNotify,
  decideOwnerNotify,
  sourceFromDecision,
};
