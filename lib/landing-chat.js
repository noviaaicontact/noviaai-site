/**
 * Chatbot accueil noviaai.ca — connaissances produit + OpenAI.
 */

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const SYSTEM = `Tu es Léa, conseillère NoviaAI sur noviaai.ca. Tu réponds en français québécois, chaleureux et concis (2–4 phrases max).

PRODUIT
- NoviaAI = ligne téléphonique pro + rattrapeur SMS + inbox + agent IA pour PME au Québec.
- Numéro local (418, 514, 581…) à publier sur Google/Facebook/site.
- Appel manqué → SMS auto au client en ~5 secondes.
- Le cellulaire du commerçant sonne d'abord; si pas de réponse, l'IA prend le relais par texto.
- Inbox centralisée pour répondre aux clients.
- Widget agent pour le site web du commerçant (inclus).
- Alertes leads par courriel. L'IA peut envoyer un lien de réservation (Calendly, etc.) — pas de sync agenda automatique.
- Le propriétaire voit les conversations et peut répondre manuellement depuis le tableau de bord.

PRIX
- Forfait Pro unique : 199 $ CAD / mois (prix fondateur), essai 14 jours, sans contrat annuel.
- Carte requise pour activer la ligne. Premier prélèvement après les 14 jours d'essai.
- Annulation en un clic via portail Stripe — aucun frais caché.

MISE EN SERVICE
- Inscription, config du commerce, carte → ligne locale activée.
- Option : garder son numéro actuel via renvoi d'appel (pas de portage obligatoire).
- L'IA peut envoyer un lien de réservation ; le propriétaire confirme les RDV et peut répondre manuellement dans l'inbox.

RÈGLES
- Ne invente pas de fonctionnalités absentes ci-dessus.
- Pour s'inscrire : dirige vers /signup.html?plan=pro
- Pour une démo visuelle : /dashboard.html?demo=1
- Pour le détail : /comment-ca-marche.html
- Support : noviaai.contact@gmail.com
- Pas de markdown. Pas de listes longues.`;

function fallbackReply(message) {
  const t = String(message || '').toLowerCase();
  if (/prix|tarif|combien|co[uû]t|\$|199/.test(t)) {
    return 'Le forfait Pro est à 199 $/mois (prix fondateur), avec 14 jours d\'essai gratuit et sans contrat. Vous pouvez vous inscrire ici : /signup.html?plan=pro';
  }
  if (/essai|gratuit|14/.test(t)) {
    return 'Essai 14 jours : carte requise pour activer la ligne, premier prélèvement après l\'essai. Annulation en un clic. Inscription : /signup.html?plan=pro';
  }
  if (/annul|contrat|engagement/.test(t)) {
    return 'Aucun contrat annuel. Vous annulez quand vous voulez depuis le portail de facturation Stripe.';
  }
  if (/combien de temps|mise en service|actif|2 min|5 min/.test(t)) {
    return 'Comptez environ 2 à 5 minutes : inscription, configuration, carte, puis votre numéro local s\'active automatiquement.';
  }
  if (/sms|texto|appel|manqu/.test(t)) {
    return 'Quand un client appelle votre ligne NoviaAI et que vous ne répondez pas, un SMS personnalisé part automatiquement en quelques secondes. L\'IA peut ensuite converser par texto.';
  }
  if (/qu[eé]bec|418|514|581|num[eé]ro|ligne/.test(t)) {
    return 'On vous attribue un numéro local Québec (418, 514, 581…) à publier sur Google et vos réseaux. Votre cellulaire sonne quand on appelle ce numéro.';
  }
  if (/podium|concurrent|compar/.test(t)) {
    return 'NoviaAI vise les PME québécoises : tout-en-un (ligne + SMS + inbox + IA) à 199 $/mois, en français, sans contrat long — souvent moins cher que Podium.';
  }
  if (/d[eé]mo|essayer|voir/.test(t)) {
    return 'Vous pouvez voir une démo interactive ici : /dashboard.html?demo=1 — ou démarrer votre essai : /signup.html?plan=pro';
  }
  if (/humain|parler|appel|rappel|contact/.test(t)) {
    return 'Pour parler à l\'équipe NoviaAI : noviaai.contact@gmail.com — ou inscrivez-vous pour activer votre propre ligne.';
  }
  return 'Bonne question! NoviaAI aide les commerces à ne plus perdre les clients qui appellent — SMS auto après appel manqué, inbox et agent IA. Essai 14 jours : /signup.html?plan=pro — Démo : /dashboard.html?demo=1';
}

async function generateLandingReply(history, userMessage) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return fallbackReply(userMessage);

  const messages = [
    { role: 'system', content: SYSTEM },
    ...(history || []).slice(-8).map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    })),
    { role: 'user', content: userMessage },
  ];

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        max_tokens: 280,
        temperature: 0.35,
      }),
    });
    if (!res.ok) {
      console.error('landing-chat OpenAI', res.status);
      return fallbackReply(userMessage);
    }
    const data = await res.json();
    let text = data.choices?.[0]?.message?.content?.trim() || '';
    text = text.replace(/\*\*/g, '');
    return text || fallbackReply(userMessage);
  } catch (e) {
    console.error('landing-chat', e.message);
    return fallbackReply(userMessage);
  }
}

module.exports = { generateLandingReply, fallbackReply };
