#!/usr/bin/env node
/**
 * Crée ou réinitialise le compte admin Supabase (sans tenant client).
 * Usage: node scripts/create-admin-user.cjs [email] [password]
 */
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

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

function netlifyEnv(name) {
  try {
    return execSync(`npx --yes netlify env:get ${name}`, {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('npm ')) || '';
  } catch {
    return '';
  }
}

loadEnvFile();
if (!process.env.SUPABASE_URL) process.env.SUPABASE_URL = netlifyEnv('SUPABASE_URL');
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  process.env.SUPABASE_SERVICE_ROLE_KEY = netlifyEnv('SUPABASE_SERVICE_ROLE_KEY');
}

const email = (process.argv[2] || process.env.ADMIN_EMAIL || 'noviaai.contact@gmail.com').trim().toLowerCase();
const password = process.argv[3] || process.env.ADMIN_INITIAL_PASSWORD || `NoviaAdmin-${Date.now().toString(36)}!9`;

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis.');
    process.exit(1);
  }

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: list, error: listErr } = await db.auth.admin.listUsers({ perPage: 200 });
  if (listErr) throw listErr;

  const existing = (list.users || []).find((u) => (u.email || '').toLowerCase() === email);

  if (existing) {
    const { error } = await db.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: { ...(existing.user_metadata || {}), role: 'admin', novia_admin: true },
    });
    if (error) throw error;
    console.log('Compte admin mis à jour.');
    console.log('EMAIL:', email);
    console.log('PASSWORD:', password);
    return;
  }

  const { error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { role: 'admin', novia_admin: true },
  });
  if (error) throw error;

  console.log('Compte admin créé.');
  console.log('EMAIL:', email);
  console.log('PASSWORD:', password);
  console.log('\nVérifiez ADMIN_EMAIL=' + email + ' dans Netlify.');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
