/**
 * Vérifie hors ligne que le formulaire /decouvrir accepte une soumission sans
 * les deux questions de qualification, devenues optionnelles. Aucun appel
 * réseau, aucune écriture : on exerce directement le validateur du serveur.
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { validateCapture } = require('../lib/marketing-lead.js');

const base = {
  formVariant: 'capture',
  firstName: 'Marc',
  businessName: 'Plomberie Marc Tremblay',
  phone: '418 555-0199',
  email: 'marc@plomberietremblay.ca',
  utm: { source: 'facebook', campaign: 'QC-Plombier' },
};

const cas = [
  ['champs optionnels vides', { ...base, missedCalls: '', clientValue: '' }, true],
  ['champs optionnels absents', { ...base }, true],
  ['un seul rempli', { ...base, missedCalls: '11-20', clientValue: '' }, true],
  ['les deux remplis', { ...base, missedCalls: '11-20', clientValue: '250-500' }, true],
  ['valeur bidon refusee', { ...base, missedCalls: 'nawak', clientValue: '' }, false],
  ['telephone manquant refuse', { ...base, phone: '' }, false],
  ['courriel invalide refuse', { ...base, email: 'pas-un-courriel' }, false],
  ['sans courriel accepte', { ...base, email: '' }, true],
  ['courriel absent accepte', (() => { const c = { ...base }; delete c.email; return c; })(), true],
];

let echecs = 0;
for (const [nom, corps, doitPasser] of cas) {
  const { errors, lead } = validateCapture(corps);
  const passe = errors.length === 0;
  const ok = passe === doitPasser;
  if (!ok) echecs += 1;
  console.log(
    `${ok ? 'OK   ' : 'ECHEC'} ${nom.padEnd(28)} ` +
      `attendu=${doitPasser ? 'accepte' : 'refuse'} obtenu=${passe ? 'accepte' : 'refuse'}` +
      (errors.length ? `  erreurs=[${errors.join(', ')}]` : '')
  );
  if (passe && lead) {
    console.log(
      `        colonnes ecrites -> appels=${JSON.stringify(lead.missed_calls_per_month)} ` +
        `valeur=${JSON.stringify(lead.avg_client_value)} ` +
        `estime=${JSON.stringify(lead.estimated_recovery_monthly)}`
    );
  }
}

console.log(`\n${echecs === 0 ? 'Tous les cas se comportent comme prevu.' : `${echecs} cas en echec.`}`);
process.exit(echecs === 0 ? 0 : 1);
