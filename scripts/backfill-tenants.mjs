/** Crée un tenant pour chaque compte auth sans commerce. */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/).forEach((line) => {
  const t = line.trim();
  if (!t || t.startsWith('#')) return;
  const i = t.indexOf('=');
  if (i === -1) return;
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
});

const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data: users, error: listErr } = await db.auth.admin.listUsers({ perPage: 100 });
if (listErr) throw listErr;

let created = 0;
for (const user of users.users) {
  const { data: existing } = await db.from('tenants').select('id').eq('user_id', user.id).maybeSingle();
  if (existing) continue;
  const { error } = await db.from('tenants').insert({
    user_id: user.id,
    email: user.email,
    business_name: 'Mon commerce',
    contact_email: user.email,
    subscription_status: 'trialing',
    plan: 'pro',
  });
  if (error) {
    console.error('❌', user.email, error.message);
  } else {
    console.log('✅ Tenant créé pour', user.email);
    created++;
  }
}
console.log('\nTerminé —', created, 'tenant(s) créé(s).');
