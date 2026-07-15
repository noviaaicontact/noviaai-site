/**
 * Kit de démarrage générique pour un nouveau commerce.
 * Valeurs sûres (pas de prix, pas d'adresse inventée) — le client personnalise ensuite.
 */

const DEFAULT_HOURS = {
  lundi: { ouvert: true, debut: '9h', fin: '17h' },
  mardi: { ouvert: true, debut: '9h', fin: '17h' },
  mercredi: { ouvert: true, debut: '9h', fin: '17h' },
  jeudi: { ouvert: true, debut: '9h', fin: '17h' },
  vendredi: { ouvert: true, debut: '9h', fin: '17h' },
  samedi: { ouvert: false },
  dimanche: { ouvert: false },
};

const DEFAULT_AGENT_NAME = 'Léa';
const DEFAULT_AGENT_TONE = 'Français québécois, chaleureux, amical et professionnel';

function defaultWelcomeSms(businessName, agentName) {
  const biz = businessName || 'notre commerce';
  const agent = agentName || DEFAULT_AGENT_NAME;
  return `Bonjour! Ici ${agent}, de ${biz}. Comment puis-je vous aider?`;
}

function defaultMissedCallSms(businessName, agentName) {
  const biz = businessName || 'notre commerce';
  const agent = agentName || DEFAULT_AGENT_NAME;
  return `Bonjour! Ici ${agent}, de ${biz}. Désolé, on a manqué votre appel! Répondez à ce texto — je vous réponds tout de suite.`;
}

/** Objet prêt à merger dans une ligne tenant / payload onboarding */
function getChatbotStarterKit(opts = {}) {
  const businessName = String(opts.businessName || opts.business_name || 'Mon commerce').trim() || 'Mon commerce';
  const agentName = String(opts.agentName || opts.agent_name || DEFAULT_AGENT_NAME).trim() || DEFAULT_AGENT_NAME;
  return {
    agent_name: agentName,
    agent_tone: DEFAULT_AGENT_TONE,
    welcome_sms: defaultWelcomeSms(businessName, agentName),
    missed_call_sms: defaultMissedCallSms(businessName, agentName),
    hours: { ...DEFAULT_HOURS },
  };
}

/**
 * Remplit uniquement les champs vides (ne remplace pas ce que le client a déjà saisi).
 * FAQ et politiques restent vides — le client les ajoute dans Agent.
 */
function withChatbotDefaults(payload) {
  const p = payload && typeof payload === 'object' ? { ...payload } : {};
  const businessName = p.business_name || 'Mon commerce';
  const agentName = (p.agent_name && String(p.agent_name).trim()) || DEFAULT_AGENT_NAME;
  const starter = getChatbotStarterKit({ businessName, agentName });

  if (!p.agent_name || !String(p.agent_name).trim()) p.agent_name = starter.agent_name;
  if (!p.agent_tone || !String(p.agent_tone).trim()) p.agent_tone = starter.agent_tone;
  if (!p.welcome_sms || !String(p.welcome_sms).trim()) p.welcome_sms = starter.welcome_sms;
  if (!p.missed_call_sms || !String(p.missed_call_sms).trim()) p.missed_call_sms = starter.missed_call_sms;
  if (!p.hours || typeof p.hours !== 'object' || !Object.keys(p.hours).length) {
    p.hours = starter.hours;
  }
  if (!Array.isArray(p.faq)) p.faq = [];
  if (!Array.isArray(p.policies)) p.policies = [];
  return p;
}

module.exports = {
  DEFAULT_HOURS,
  DEFAULT_AGENT_NAME,
  DEFAULT_AGENT_TONE,
  defaultWelcomeSms,
  defaultMissedCallSms,
  getChatbotStarterKit,
  withChatbotDefaults,
};
