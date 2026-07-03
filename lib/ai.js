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

  return `Tu es ${agent.nom_agent || 'Léa'}, employée virtuelle de ${biz.nom_court || 'ce commerce'}.
${agent.role || ''}
Ton: ${agent.ton || 'Français québécois, chaleureux et professionnel'}
${agent.vouvoiement !== false ? 'Vouvoiement.' : 'Tutoiement.'}

COMMERCE
Type: ${biz.type || 'PME'}
Adresse: ${[coord.adresse_ligne1, coord.ville, coord.province].filter(Boolean).join(', ') || 'non précisée'}
${coord.site_web ? `Site web: ${coord.site_web}` : ''}
${coord.reservation_url ? `Réservation en ligne: ${coord.reservation_url}` : ''}

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
Rappel humain: ${scripts.transfert_humain || 'Je transmets à l\'équipe pour un rappel.'}

RÈGLES STRICTES
${rules}
- Réponses COURTES pour SMS (2–4 phrases max, ~${MAX_SMS} caractères).
- Ne confirme JAMAIS un rendez-vous à une heure précise — note la demande ou donne le lien de réservation.
- Si tu ne sais pas, propose un rappel humain.
- Pas de markdown. Pas de listes numérotées longues.`;
}

async function generateReply(dossier, history, userMessage, tenantId) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  let kbContext = '';
  if (tenantId) {
    try {
      const { searchKnowledge } = require('./knowledge');
      const hits = await searchKnowledge(tenantId, userMessage, 4);
      if (hits.length) {
        kbContext = '\n\nEXTRAITS PERTINENTS (site web / documents indexés):\n'
          + hits.map((h, i) => `[${i + 1}] ${h.content}`).join('\n---\n');
      }
    } catch (e) {
      console.error('kb context skip', e.message);
    }
  }

  const messages = [
    { role: 'system', content: buildSystemPrompt(dossier) + kbContext },
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
