/** Derniers appels/SMS Twilio — node scripts/twilio-recent-logs.mjs */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/).forEach((line) => {
  const t = line.trim();
  if (!t || t.startsWith('#')) return;
  const i = t.indexOf('=');
  if (i === -1) return;
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
});

const twilio = (await import('twilio')).default;
const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

console.log('\n=== Appels récents (872) ===\n');
const calls = await client.calls.list({ to: '+18722535474', limit: 10 });
if (!calls.length) {
  console.log('❌ AUCUN appel reçu sur +18722535474');
  console.log('   → Le renvoi depuis votre 581 ne fonctionne probablement PAS.');
  console.log('   → Composez *61*18722535474# sur VOTRE 581.');
} else {
  calls.forEach((c) => {
    console.log(`${c.dateCreated?.toISOString?.() || c.dateCreated} | de ${c.from} | statut ${c.status} | durée ${c.duration}s`);
  });
}

console.log('\n=== SMS récents ===\n');
const msgs = await client.messages.list({ from: '+18722535474', limit: 10 });
if (!msgs.length) console.log('❌ Aucun SMS envoyé depuis le 872');
else {
  msgs.forEach((m) => {
    console.log(`${m.dateCreated} | vers ${m.to} | ${m.status} | ${(m.body || '').slice(0, 50)}`);
    if (m.errorCode) console.log(`   ⚠️ Erreur ${m.errorCode}: ${m.errorMessage}`);
  });
}

console.log('\n=== Numéros vérifiés (trial) ===\n');
try {
  const v = await client.outgoingCallerIds.list({ limit: 20 });
  if (!v.length) console.log('❌ AUCUN numéro vérifié — ajoutez le cell de votre ami sur Twilio!');
  else v.forEach((n) => console.log('✅', n.phoneNumber, n.friendlyName || ''));
} catch (e) {
  console.log('Verified IDs:', e.message);
}

console.log('');
