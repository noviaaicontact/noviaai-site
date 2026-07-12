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

function defaultFaq() {
  return [
    {
      question: 'Comment prendre rendez-vous ou demander une soumission?',
      reponse: 'Dites-moi ce dont vous avez besoin. Si un lien de réservation ou de soumission est configuré, je vous l\'envoie. Sinon, je note votre nom, votre numéro et vos disponibilités pour qu\'on vous rappelle.',
    },
    {
      question: 'Quels sont vos horaires?',
      reponse: 'Je peux vous indiquer nos heures d\'ouverture selon la base du commerce. Pour un créneau précis, je prends vos disponibilités ou je vous envoie le lien de réservation s\'il est disponible.',
    },
    {
      question: 'Est-ce que vous êtes ouverts aujourd\'hui?',
      reponse: 'Je vérifie selon nos horaires configurés. Si nous sommes fermés, je peux quand même noter votre demande pour un rappel.',
    },
  ];
}

function defaultPolicies() {
  return [
    'Nous rappelons généralement dans les meilleurs délais pendant les heures d\'ouverture.',
    'Les informations de prix et disponibilités exactes sont confirmées par l\'équipe — l\'agente virtuelle ne confirme pas un rendez-vous définitif.',
    'Pour annuler ou modifier un rendez-vous déjà confirmé, contactez-nous directement ou répondez à ce message.',
  ];
}

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
    faq: defaultFaq(),
    policies: defaultPolicies(),
  };
}

/**
 * Remplit uniquement les champs vides (ne remplace pas ce que le client a déjà saisi).
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
  if (!Array.isArray(p.faq) || !p.faq.length) p.faq = starter.faq;
  if (!Array.isArray(p.policies) || !p.policies.length) p.policies = starter.policies;
  return p;
}

module.exports = {
  DEFAULT_HOURS,
  DEFAULT_AGENT_NAME,
  DEFAULT_AGENT_TONE,
  defaultFaq,
  defaultPolicies,
  defaultWelcomeSms,
  defaultMissedCallSms,
  getChatbotStarterKit,
  withChatbotDefaults,
};
