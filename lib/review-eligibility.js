const { classifyIntent } = require('./agent-tools');

const SATISFACTION_RE = /merci|thank you|super|parfait|génial|genial|excellent|à bientôt|a bientot|au plaisir|belle journée|belle journee|content|satisfait|géniale|parfaite|nickel|top|wow|bravo/i;

const NEGATIVE_RE = /plainte|frustr|déçu|decu|déception|deception|nul|horrible|scandale|rembours|incompétent|incompetent|inacceptable|ridicule|fâch|fach|colère|colere|énerv|enerve|insatisf|pas content|pas satisf|jamais|pire|arnaque|mensonge|inutile|décevant|decevant|problème non résolu|probleme non resolu|toujours pas|ça marche pas|ca marche pas|marche pas/i;

const RESOLUTION_CONFIRM_RE = /c'est bon|c est bon|ok parfait|d'accord|d accord|compris|ça me convient|ca me convient|je passe|on se voit|à jeudi|a jeudi|à demain|a demain|confirmé|confirme/i;

function normalizeInboundMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m) => m && (m.direction === 'inbound' || m.role === 'user'))
    .map((m) => ({
      role: 'user',
      content: String(m.body || m.content || '').trim(),
    }))
    .filter((m) => m.content);
}

function buildTranscript(history, userMessage, aiReply) {
  const lines = [];
  (history || []).forEach((m) => {
    const role = m.role === 'user' ? 'Client' : 'NoviaAI';
    if (m.content) lines.push(`${role}: ${m.content}`);
  });
  if (userMessage) lines.push(`Client: ${userMessage}`);
  if (aiReply) lines.push(`NoviaAI: ${aiReply}`);
  return lines.join('\n').slice(-4000);
}

function hasNegativeInboundText(text) {
  return NEGATIVE_RE.test(String(text || ''));
}

function hasSatisfactionSignal(userMessage) {
  return SATISFACTION_RE.test(String(userMessage || ''));
}

function hasResolutionSignal({ userMessage, aiReply, thread, hasLead }) {
  if (hasLead || (thread && (thread.status === 'lead'))) return true;
  const intent = classifyIntent(userMessage, aiReply);
  if (intent && (intent.type === 'appointment' || intent.type === 'lead')) return true;
  if (RESOLUTION_CONFIRM_RE.test(String(userMessage || ''))) return true;
  return false;
}

function scanHistoryForNegatives(messages, events) {
  for (const m of messages) {
    if (hasNegativeInboundText(m.content)) {
      return { blocked: true, reason: 'plainte ou frustration détectée dans la conversation' };
    }
  }
  const evts = events || [];
  if (evts.some((e) => e.event_type === 'human_transfer')) {
    return { blocked: true, reason: 'demande de transfert humain dans la conversation' };
  }
  return { blocked: false };
}

async function analyzeWithOpenAI(transcript) {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !transcript || transcript.length < 8) {
    return { eligible: true, sentiment: 'neutral', reason: 'openai_skip' };
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 120,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Tu analyses une conversation SMS client ↔ commerce (français québécois).
Décide si on peut envoyer une demande d'avis Google MAINTENANT.
Règles:
- eligible=false si frustration, plainte, problème non résolu, ton négatif, ou conflit à un moment.
- eligible=true seulement si le client semble satisfait OU la demande est résolue (RDV, info donnée, merci sincère).
- Un simple "merci" après une plainte = eligible false.
Réponds en JSON: {"eligible":boolean,"sentiment":"positive"|"neutral"|"negative","reason":"courte phrase"}`,
        },
        { role: 'user', content: transcript },
      ],
    }),
  });

  if (!res.ok) {
    console.warn('review eligibility OpenAI', res.status);
    return { eligible: true, sentiment: 'neutral', reason: 'openai_error_fallback' };
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || '{}';
  try {
    const parsed = JSON.parse(raw);
    return {
      eligible: !!parsed.eligible,
      sentiment: parsed.sentiment || 'neutral',
      reason: parsed.reason || '',
    };
  } catch {
    return { eligible: false, sentiment: 'negative', reason: 'parse_error' };
  }
}

async function evaluateReviewEligibility({
  userMessage,
  aiReply,
  history,
  inboundMessages,
  events,
  thread,
  hasLead,
}) {
  const inbound = inboundMessages?.length
    ? inboundMessages
    : normalizeInboundMessages(
      (history || []).map((m) => ({
        direction: m.role === 'user' ? 'inbound' : 'outbound',
        body: m.content,
      }))
    );

  const negativeScan = scanHistoryForNegatives(inbound, events);
  if (negativeScan.blocked) {
    return { eligible: false, reason: negativeScan.reason, trigger: null };
  }

  const satisfaction = hasSatisfactionSignal(userMessage);
  const resolution = hasResolutionSignal({ userMessage, aiReply, thread, hasLead });
  if (!satisfaction && !resolution) {
    return { eligible: false, reason: 'pas de signal de satisfaction ou de résolution', trigger: null };
  }

  const transcript = buildTranscript(history, userMessage, aiReply);
  const ai = await analyzeWithOpenAI(transcript);
  if (!ai.eligible || ai.sentiment === 'negative') {
    return {
      eligible: false,
      reason: ai.reason || 'ton de conversation non favorable',
      trigger: satisfaction ? 'satisfaction' : 'resolution',
    };
  }

  return {
    eligible: true,
    reason: ai.reason || (satisfaction ? 'client satisfait' : 'conversation résolue'),
    trigger: satisfaction ? 'satisfaction' : 'resolution',
  };
}

module.exports = {
  evaluateReviewEligibility,
  hasNegativeInboundText,
  hasSatisfactionSignal,
  scanHistoryForNegatives,
  SATISFACTION_RE,
  NEGATIVE_RE,
};
