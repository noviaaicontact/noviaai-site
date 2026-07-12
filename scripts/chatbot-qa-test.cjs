/**
 * Batterie de tests QA chatbot PME.
 * Usage: node scripts/chatbot-qa-test.cjs
 * Nécessite OPENAI_API_KEY (+ optionnel SUPABASE_* pour la base de connaissances).
 */
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) return;
    const k = m[1].trim();
    const v = m[2].trim().replace(/^["']|["']$/g, '');
    if (!process.env[k]) process.env[k] = v;
  });
}

function silentNetlifyEnv(name) {
  try {
    const out = execSync(`npx --yes netlify env:get ${name}`, {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const line = String(out)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('npm ') && !/^Unknown/i.test(l));
    return line || '';
  } catch {
    return '';
  }
}

loadEnvFile();
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = silentNetlifyEnv('OPENAI_API_KEY');
if (!process.env.SUPABASE_URL) process.env.SUPABASE_URL = silentNetlifyEnv('SUPABASE_URL');
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  process.env.SUPABASE_SERVICE_ROLE_KEY = silentNetlifyEnv('SUPABASE_SERVICE_ROLE_KEY');
}

const { rowToDossier } = require('../lib/dossier-builder');
const { generateReply, buildSystemPrompt } = require('../lib/ai');

const TENANT = {
  id: '3cf445f9-22a5-4a6a-9f7f-742d12ce1f1f',
  business_name: 'spa piscine sansouci',
  business_type: 'Spas et piscines',
  agent_name: 'jean',
  agent_tone: 'francais quebecois, chaleureux',
  website_url: 'https://www.spasetpiscines.com/',
  public_phone: '418-836-3138',
  twilio_number: '+15814996602',
  phone_forward: '5819095332',
  existing_business_number: '+15814996602',
  line_mode: 'new',
  provisioning_status: 'active',
  address_line: '',
  city: 'Lévis',
  province: 'QC',
  reservation_url: 'https://www.spasetpiscines.com/soumission-piscines-hors-terre/',
  reservation_links: [
    { label: 'Piscine hors terre', url: 'https://www.spasetpiscines.com/soumission-piscines-hors-terre/' },
    { label: 'Piscine creusée', url: 'https://www.spasetpiscines.com/soumission-piscines-creusees/' },
  ],
  services: [],
  faq: [],
  policies: [],
  hours: {
    lundi: { ouvert: true, debut: '9h', fin: '17h' },
    mardi: { ouvert: true, debut: '9h', fin: '17h' },
    mercredi: { ouvert: true, debut: '9h', fin: '17h' },
    jeudi: { ouvert: true, debut: '9h', fin: '17h' },
    vendredi: { ouvert: true, debut: '9h', fin: '17h' },
    samedi: { ouvert: false },
    dimanche: { ouvert: false },
  },
};

const QUESTIONS = [
  'Bonjour',
  'Qui êtes-vous?',
  'Quel est votre numéro de téléphone?',
  'Comment je peux vous joindre?',
  'Avez-vous un numéro?',
  'Quel est votre site web?',
  'Où je trouve vos infos en ligne?',
  'Où êtes-vous situés?',
  'Vous êtes à Lévis?',
  'Quels sont vos horaires?',
  'Êtes-vous ouverts aujourd\'hui?',
  'Êtes-vous ouverts samedi?',
  'À quelle heure fermez-vous le vendredi?',
  'Je veux une soumission',
  'Envoyez-moi le lien de soumission',
  'Je veux une piscine hors terre',
  'Je veux une piscine creusée',
  'Pouvez-vous m\'envoyer le formulaire?',
  'Je veux un devis',
  'C\'est pour un spa — avez-vous un lien?',
  'Quels services offrez-vous?',
  'Faites-vous l\'ouverture de piscine?',
  'Faites-vous l\'analyse d\'eau?',
  'Vendez-vous des produits chimiques?',
  'Avez-vous des promotions?',
  'C\'est combien une piscine?',
  'Quel est le prix d\'un spa?',
  'Confirmez-moi un rendez-vous demain à 14h',
  'Je m\'appelle Marie, rappelez-moi au 418-555-1234',
  'Je suis dispo mardi après-midi',
  'Donnez-moi un diagnostic médical',
  'Inventez un prix pour moi',
  'Le lien encore une fois s\'il vous plaît',
];

function expectChecks(question, reply, dossier) {
  const issues = [];
  const r = String(reply || '');
  const phone = String(dossier.coordonnees.telephone || '');
  const phoneDigits = phone.replace(/\D/g, '');
  const links = (dossier.coordonnees.reservation_links || []).map((l) => l.url);

  if (!r.trim()) issues.push('réponse vide');

  if (/téléphone|numéro|joindre/i.test(question)) {
    if (phoneDigits && !r.replace(/\D/g, '').includes(phoneDigits.slice(-10))) {
      issues.push('devrait inclure le numéro public');
    }
    if (/15814996602|5814996602/.test(r.replace(/\D/g, '')) && phoneDigits === '4188363138') {
      issues.push('a donné la ligne Twilio au lieu du numéro site');
    }
    if (/ne (peux|peut) pas (fournir|donner).*numéro/i.test(r)) {
      issues.push('refuse à tort de donner le numéro');
    }
  }

  if (/soumission|devis|formulaire|lien|hors terre|creusée/i.test(question)
    && !/confirmez-moi|diagnostic|inventez|encore une fois/i.test(question)) {
    const hasLink = links.some((u) => r.includes(u)) || /https?:\/\//i.test(r);
    if (!hasLink) issues.push('devrait coller une URL de soumission');
  }

  if (/encore une fois/i.test(question)) {
    const hasLink = links.some((u) => r.includes(u)) || /https?:\/\//i.test(r);
    if (!hasLink) issues.push('devrait recoller une URL');
  }

  if (/inventez un prix/i.test(question)) {
    if (/\$\s*\d{2,}/.test(r) && !/varie|soumission|devis|magasin|équipe/i.test(r)) {
      issues.push('semble inventer un prix fixe');
    }
  }

  if (/site web|infos en ligne/i.test(question)) {
    if (!/spasetpiscines\.com/i.test(r) && dossier.coordonnees.site_web) {
      issues.push('devrait mentionner le site web');
    }
  }

  return issues;
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY manquante.');
    process.exit(1);
  }

  const dossier = rowToDossier(TENANT);
  const prompt = buildSystemPrompt(dossier);

  console.log('=== Vérification prompt ===');
  [
    ['téléphone', /Téléphone.*418-836-3138|4188363138/i.test(prompt)],
    ['site', /spasetpiscines\.com/i.test(prompt)],
    ['liens', /soumission-piscines/i.test(prompt)],
    ['règle tel', /RÈGLE TÉLÉPHONE/i.test(prompt)],
    ['règle lien', /RÈGLE LIEN/i.test(prompt)],
  ].forEach(([label, ok]) => console.log(`${ok ? 'OK' : 'FAIL'} prompt:${label}`));

  console.log(`\n=== ${QUESTIONS.length} questions IA (KB=${!!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)}) ===\n`);
  let fail = 0;
  let warn = 0;
  const useKb = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

  for (let i = 0; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i];
    process.stdout.write(`[${i + 1}/${QUESTIONS.length}] ${q.slice(0, 58)}… `);
    try {
      const reply = await generateReply(dossier, [], q, useKb ? TENANT.id : null);
      const issues = expectChecks(q, reply, dossier);
      if (!reply) {
        console.log('FAIL (null)');
        fail++;
      } else if (issues.length) {
        console.log(`WARN — ${issues.join('; ')}`);
        console.log(`   → ${reply.replace(/\n/g, ' ').slice(0, 220)}`);
        warn++;
      } else {
        console.log('OK');
        console.log(`   → ${reply.replace(/\n/g, ' ').slice(0, 180)}`);
      }
    } catch (e) {
      console.log(`FAIL — ${e.message}`);
      fail++;
    }
    await new Promise((r) => setTimeout(r, 350));
  }

  console.log(`\n=== Résumé: ${QUESTIONS.length - fail - warn} OK · ${warn} WARN · ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
