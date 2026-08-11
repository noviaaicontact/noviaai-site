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

PRIX (CAD / mois)
- Essentiel : 149 $/mois — 50 conversations/mois. Idéal pour 10–40 appels manqués / mois.
- Croissance : 299 $/mois — 200 conversations/mois. Commerces actifs (~150 appels manqués). Forfait recommandé.
- Pro : 499 $/mois — 750 conversations/mois. Haut volume / multi-lignes.
- Une conversation = un prospect distinct qui échange avec NoviaAI.
- Essai 14 jours, sans contrat annuel.
- Pendant l'essai on mesure l'usage pour recommander le bon forfait.
- Garantie 30 jours : si aucun client n'est rattrapé dans les 30 premiers jours payants, remboursement sur demande.
- Aucune carte requise pour démarrer. Essai gratuit 14 jours, puis paiement pour continuer (sinon les fonctions se mettent en pause).
- Annulation en un clic via portail Stripe — aucun frais caché.

MISE EN SERVICE
- Inscription, config du commerce → ligne locale activée (sans carte).
- Option : garder son numéro actuel via renvoi d'appel (pas de portage obligatoire).
- L'IA peut envoyer un lien de réservation ; le propriétaire confirme les RDV et peut répondre manuellement dans l'inbox.

RÈGLES
- Ne invente pas de fonctionnalités absentes ci-dessus.
- Pour s'inscrire : dirige vers /signup.html?plan=croissance (forfait recommandé) sauf si le client demande Essentiel ou Pro.
- Pour une démo visuelle : /dashboard.html?demo=1
- Pour le détail : /comment-ca-marche.html
- Support : noviaai.contact@gmail.com
- Pas de markdown. Pas de listes longues.`;

function fallbackReply(message) {
  const t = String(message || '').toLowerCase();
  if (/prix|tarif|combien|co[uû]t|\$|149|299|499|forfait/.test(t)) {
    return 'Trois forfaits CAD/mois : Essentiel 149 $ (50 conversations), Croissance 299 $ (200 — recommandé), Pro 499 $ (750). Essai 14 jours, sans contrat. Inscription : /signup.html?plan=croissance';
  }
  if (/garantie|rembours/.test(t)) {
    return 'Garantie 30 jours : si aucun client n\'est rattrapé dans les 30 premiers jours payants, on rembourse sur demande. Essai 14 jours avant ça. Inscription : /signup.html?plan=croissance';
  }
  if (/essai|gratuit|14/.test(t)) {
    return 'Essai 14 jours : aucune carte requise. Testez avec votre vraie ligne ; après l\'essai, les fonctions se mettent en pause tant que vous n\'activez pas un forfait. Inscription : /signup.html?plan=croissance';
  }
  if (/annul|contrat|engagement/.test(t)) {
    return 'Aucun contrat annuel. Vous annulez quand vous voulez depuis le portail de facturation Stripe.';
  }
  if (/combien de temps|mise en service|actif|2 min|5 min/.test(t)) {
    return 'Comptez environ 2 à 5 minutes : inscription, configuration, puis votre numéro local s\'active automatiquement — sans carte.';
  }
  if (/sms|texto|appel|manqu/.test(t)) {
    return 'Quand un client appelle votre ligne NoviaAI et que vous ne répondez pas, un SMS personnalisé part automatiquement en quelques secondes. L\'IA peut ensuite converser par texto.';
  }
  if (/qu[eé]bec|418|514|581|num[eé]ro|ligne/.test(t)) {
    return 'On vous attribue un numéro local Québec (418, 514, 581…) à publier sur Google et vos réseaux. Votre cellulaire sonne quand on appelle ce numéro.';
  }
  if (/podium|concurrent|compar/.test(t)) {
    return 'NoviaAI vise les PME québécoises : ligne + SMS + inbox + IA dès 149 $/mois, en français, sans contrat, avec garantie 30 jours — souvent bien moins cher que Podium.';
  }
  if (/d[eé]mo|essayer|voir/.test(t)) {
    return 'Vous pouvez voir une démo interactive ici : /dashboard.html?demo=1 — ou démarrer votre essai : /signup.html?plan=croissance';
  }
  if (/humain|parler|appel|rappel|contact/.test(t)) {
    return 'Pour parler à l\'équipe NoviaAI : noviaai.contact@gmail.com — ou inscrivez-vous pour activer votre propre ligne.';
  }
  return 'Bonne question! NoviaAI aide les commerces à ne plus perdre les clients qui appellent — SMS auto après appel manqué, inbox et agent IA. Essai 14 jours : /signup.html?plan=croissance — Démo : /dashboard.html?demo=1';
}

async function generateLandingReply(history, userMessage) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return fallbackReply(userMessage);

  const messages = [
    { role: 'system', content: SYSTEM },
    ...(history || []).slice(-8).map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').slice(0, 2000),
    })),
    { role: 'user', content: String(userMessage || '').slice(0, 2000) },
  ];

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.4,
        max_tokens: 220,
        messages,
      }),
    });
    if (!res.ok) {
      console.warn('landing-chat openai', res.status, await res.text());
      return fallbackReply(userMessage);
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    return text || fallbackReply(userMessage);
  } catch (e) {
    console.warn('landing-chat', e.message);
    return fallbackReply(userMessage);
  }
}

module.exports = { generateLandingReply, fallbackReply };
