// Réponses SMS IA basées sur le dossier commerce (OpenAI).

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_SMS = 480;

function formatHours(hours) {
  const h = (hours && hours.horaire) || hours || {};
  return Object.entries(h)
    .map(([day, v]) => {
      if (!v || !v.ouvert) return `${day}: fermé`;
      return `${day}: ${v.debut || '?'} – ${v.fin || '?'}`;
    })
    .join('\n');
}

function buildSystemPrompt(dossier) {
  const biz = (dossier && dossier.entreprise) || {};
  const agent = (dossier && dossier.identite_agent) || {};
  const coord = (dossier && dossier.coordonnees) || {};
  const scripts = (dossier && dossier.scripts) || {};
  const services = (dossier.services || [])
    .map((s) => `- ${s.nom}${s.prix ? ` : ${s.prix}` : ''}${s.description_courte && s.description_courte !== s.nom ? ` (${s.description_courte})` : ''}`)
    .join('\n');
  const faq = (dossier.faq || [])
    .map((f) => `Q: ${f.question}\nR: ${f.reponse}`)
    .join('\n\n');
  const policies = (dossier.policies || []).map((p) => `- ${p}`).join('\n');
  const rules = (agent.interdictions || []).map((r) => `- ${r}`).join('\n');

  const phonePublic = String(coord.telephone || '').trim();
  const phoneLine = phonePublic
    ? `Téléphone du commerce / site web (à donner au client si demandé): ${phonePublic}`
    : 'Téléphone du commerce: non configuré — ne pas inventer de numéro; propose un rappel.';
  const emailLine = coord.courriel
    ? `Courriel: ${coord.courriel}`
    : '';

  const reservationLinks = Array.isArray(coord.reservation_links) && coord.reservation_links.length
    ? coord.reservation_links
      .map((l) => ({
        label: String((l && l.label) || '').trim(),
        url: String((l && l.url) || '').trim(),
      }))
      .filter((l) => l.url)
    : (String(coord.reservation_url || '').trim()
      ? [{ label: '', url: String(coord.reservation_url).trim() }]
      : []);

  const reservationLine = reservationLinks.length
    ? (reservationLinks.length === 1
      ? `Lien de réservation ou de soumission (URL exacte à coller): ${reservationLinks[0].label ? reservationLinks[0].label + ' → ' : ''}${reservationLinks[0].url}`
      : `Liens de réservation ou de soumission (coller l'URL qui correspond au service demandé):\n${reservationLinks.map((l) => `- ${l.label || 'Lien'} : ${l.url}`).join('\n')}`)
    : 'Aucun lien de réservation ou de soumission configuré — propose de noter nom, téléphone et disponibilités.';

  const allText = [services, faq, policies, scripts.reservation || '', scripts.accueil || ''].join('\n');
  const foundLinks = [...allText.matchAll(/https?:\/\/[^\s<>"']+/gi)]
    .map((m) => m[0].replace(/[.,);:]+$/g, ''))
    .filter((u) => /reserv|soumis|rdv|rendez|book|formulaire|appointment|calendly|acuity|demande|contact|quote|devis/i.test(u));
  const knownUrls = new Set(reservationLinks.map((l) => l.url));
  const uniqueLinks = [...new Set(foundLinks)].filter((u) => !knownUrls.has(u)).slice(0, 4);
  const linksBlock = uniqueLinks.length
    ? `\nAutres liens utiles dans la base:\n${uniqueLinks.map((u) => `- ${u}`).join('\n')}`
    : '';

  return `Tu es ${agent.nom_agent || 'Léa'}, employée virtuelle de ${biz.nom_court || 'ce commerce'}.
${agent.role || ''}
Ton: ${agent.ton || 'Français québécois, chaleureux et professionnel'}
${agent.vouvoiement !== false ? 'Vouvoiement.' : 'Tutoiement.'}

COMMERCE
Type: ${biz.type || 'PME'}
Adresse: ${[coord.adresse_ligne1, coord.ville, coord.province].filter(Boolean).join(', ') || 'non précisée'}
${phoneLine}
${emailLine}
${coord.site_web ? `Site web: ${coord.site_web}` : ''}
${reservationLine}
${linksBlock}

HORAIRES
${formatHours(dossier.heures_ouverture)}

SERVICES (ne jamais inventer d'autres prix)
${services || '(aucun service configuré — proposez de rappeler le client)'}

FAQ
${faq || '(aucune FAQ)'}

POLITIQUES
${policies || '(aucune)'}

SCRIPTS UTILES
Accueil: ${scripts.accueil || ''}
Réservation: ${scripts.reservation || ''}
Rappel humain: ${scripts.transfert_humain || 'Je transmets à l\'équipe pour un rappel.'}

RÈGLES STRICTES
${rules}
- Réponses COURTES pour SMS (2–4 phrases max, ~${MAX_SMS} caractères).
- Ne confirme JAMAIS un rendez-vous à une heure précise — note la demande ou donne le lien de réservation/soumission.
- RÈGLE TÉLÉPHONE (obligatoire): si le client demande le numéro, comment vous joindre, ou « votre téléphone », et qu'un téléphone du commerce / site web est listé ci-dessus → donne TOUJOURS ce numéro exact (celui du site / Google). Ne donne PAS un autre numéro. Ne dis JAMAIS que tu ne peux pas fournir le numéro si il est dans la base. S'il n'y a pas de numéro configuré: dis-le clairement et propose un rappel.
- RÈGLE LIEN (obligatoire): si le client demande un RDV, une réservation, une soumission, un devis, un formulaire ou « le lien », et qu'une URL est listée ci-dessus → inclus TOUJOURS l'URL complète (https://...) dans ta réponse. Ne dis pas seulement « je vous envoie le lien » sans coller l'URL. S'il y a plusieurs liens: envoie celui qui correspond au service demandé (selon le libellé); si ce n'est pas clair, demande quel service ou envoie les liens utiles avec leur libellé. S'il n'y a aucun lien: dis-le et prends les coordonnées.
- Si tu ne sais pas, propose un rappel humain.
- Pas de markdown. Pas de listes numérotées longues.`;
}

async function generateReply(dossier, history, userMessage, tenantId) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  let dossierForPrompt = dossier;
  // Si pas de numéro public configuré, tenter celui trouvé sur le site indexé
  if (tenantId && !(dossier && dossier.coordonnees && String(dossier.coordonnees.telephone || '').trim())) {
    try {
      const { findWebsitePhone } = require('./knowledge');
      const twilio = dossier && dossier.coordonnees && dossier.coordonnees.telephone_sms;
      const webPhone = await findWebsitePhone(tenantId, twilio);
      if (webPhone) {
        dossierForPrompt = {
          ...dossier,
          coordonnees: {
            ...(dossier.coordonnees || {}),
            telephone: webPhone,
          },
        };
      }
    } catch (e) {
      console.error('website phone skip', e.message);
    }
  }

  let kbContext = '';
  if (tenantId) {
    try {
      const { searchKnowledge } = require('./knowledge');
      const hits = await searchKnowledge(tenantId, userMessage, 4);
      if (hits.length) {
        kbContext = '\n\nEXTRAITS PERTINENTS (site web / documents indexés):\n'
          + hits.map((h, i) => `[${i + 1}] ${h.content}`).join('\n---\n');
        const kbLinks = [...kbContext.matchAll(/https?:\/\/[^\s<>"']+/gi)]
          .map((m) => m[0].replace(/[.,);:]+$/g, ''))
          .filter((u) => /reserv|soumis|rdv|rendez|book|formulaire|appointment|calendly|acuity|demande|contact|quote|devis/i.test(u));
        const uniq = [...new Set(kbLinks)].slice(0, 4);
        if (uniq.length) {
          kbContext += '\n\nLiens utiles dans les extraits (à coller si le client demande soumission/RDV):\n'
            + uniq.map((u) => `- ${u}`).join('\n');
        }
      }
    } catch (e) {
      console.error('kb context skip', e.message);
    }
  }

  const messages = [
    { role: 'system', content: buildSystemPrompt(dossierForPrompt) + kbContext },
    ...(history || []).slice(-10).map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    })),
    { role: 'user', content: userMessage },
  ];

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: 220,
      temperature: 0.4,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('OpenAI error', res.status, err);
    return null;
  }

  const data = await res.json();
  let text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  text = text.trim().replace(/\*\*/g, '');
  if (text.length > MAX_SMS) text = text.slice(0, MAX_SMS - 1) + '…';
  return text || null;
}

module.exports = { generateReply, buildSystemPrompt };
