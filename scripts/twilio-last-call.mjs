import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const env = {};
readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.env'), 'utf8').split(/\r?\n/).forEach((line) => {
  const i = line.indexOf('=');
  if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
});

const twilio = (await import('twilio')).default;
const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
const call = await client.calls.list({ to: '+18722535474', limit: 1 });
if (call[0]) {
  const c = await client.calls(call[0].sid).fetch();
  console.log('Dernier appel vers 872:');
  console.log('  De:', c.from);
  console.log('  Statut:', c.status);
  console.log('  Erreur:', c.errorMessage || '—');
  console.log('  Code:', c.errorCode || '—');
}
