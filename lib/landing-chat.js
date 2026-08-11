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
- Widget agent pour le site web du commerçant (inclus dans tous les forfaits).
- Demandes d'avis Google (incluses dans tous les forfaits).
- Alertes leads par courriel. L'IA peut envoyer un lien de réservation (Calendly, etc.) — pas de sync agenda automatique.
- Le propriétaire voit les conversations et peut répondre manuellement depuis le tableau de bord.

PRIX (CAD / mois)
- Essentiel : 149 $/mois — 50 conversations/mois. Idéal pour 10–40 appels manqués / mois. Inclut widget web + avis Google.
- Croissance : 299 $/mois — 200 conversations/mois. Commerces actifs (~150 appels manqués).
- Pro : 499 $/mois — 750 conversations/mois. Haut volume / multi-lignes.
- Une conversation = un prospect distinct qui échange avec NoviaAI.
- Essai 14 jours sans carte et SANS choisir de forfait à l'inscription (capacités niveau Essentiel).
- On ne force PAS un abonnement après la création du compte. Le choix de forfait arrive seulement si le client veut continuer après l'essai.
- Garantie 30 jours : si aucun client n'est rattrapé dans les 30 premiers jours payants, remboursement sur demande.
- Annulation en un clic via portail Stripe — aucun frais caché.

MISE EN SERVICE
- Inscription, config du commerce → ligne locale activée (sans carte).
- Option : garder son numéro actuel via renvoi d'appel (pas de portage obligatoire).
- L'IA peut envoyer un lien de réservation ; le propriétaire confirme les RDV et peut répondre manuellement dans l'inbox.

RÈGLES
- Ne invente pas de fonctionnalités absentes ci-dessus.
- Pour s'inscrire / essai : dirige TOUJOURS vers /signup.html?plan=essentiel (essai = Essentiel seulement).
- Pour une démo visuelle : /dashboard.html?demo=1
- Pour le détail : /comment-ca-marche.html
- Support : noviaai.contact@gmail.com
- Pas de markdown. Pas de listes longues.`;

function fallbackReply(message) {
  const t = String(message || '').toLowerCase();
  if (/prix|tarif|combien|co[uû]t|\$|149|299|499|forfait/.test(t)) {
    return 'Trois forfaits CAD/mois après l\'essai : Essentiel 149 $ (50 conv.), Croissance 299 $ (200), Pro 499 $ (750). À l\'inscription : essai 14 jours sans carte, sans choisir de forfait. Inscription : /signup.html?plan=essentiel';
  }
  if (/garantie|rembours/.test(t)) {
    return 'Garantie 30 jours : si aucun client n\'est rattrapé dans les 30 premiers jours payants, on rembourse sur demande. Essai 14 jours avant ça, sans choisir de forfait. Inscription : /signup.html?plan=essentiel';
  }
  if (/essai|gratuit|14/.test(t)) {
    return 'Essai 14 jours : aucune carte, aucun forfait à choisir. Vous testez tout de suite ; vous ne choisissez un forfait que si vous continuez après. Inscription : /signup.html?plan=essentiel';
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
    return 'Vous pouvez voir une démo interactive ici : /dashboard.html?demo=1 — ou démarrer votre essai : /signup.html?plan=essentiel';
  }
  if (/humain|parler|appel|rappel|contact/.test(t)) {
    return 'Pour parler à l\'équipe NoviaAI : noviaai.contact@gmail.com — ou inscrivez-vous pour activer votre propre ligne.';
  }
  return 'Bonne question! NoviaAI aide les commerces à ne plus perdre les clients qui appellent — SMS auto après appel manqué, inbox et agent IA. Essai 14 jours sans choisir de forfait : /signup.html?plan=essentiel — Démo : /dashboard.html?demo=1';
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
