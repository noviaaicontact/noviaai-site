/**
 * Affiche la config Supabase pour courriels de confirmation professionnels.
 * Usage: node scripts/configure-supabase-auth-email.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const templatePath = join(root, 'supabase', 'email-template-confirm-signup.html');

const env = {};
const envPath = join(root, '.env');
if (existsSync(envPath)) {
  readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const i = line.indexOf('=');
    if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  });
}

const hasResend = !!env.RESEND_API_KEY;

console.log(`
╔══════════════════════════════════════════════════════════════╗
║  Courriel de confirmation NoviaAI (plus rassurant)           ║
╚══════════════════════════════════════════════════════════════╝

ÉTAPE 1 — SMTP Resend (expéditeur = NoviaAI, pas Supabase)
  Supabase → Authentication → SMTP Settings → Enable custom SMTP
  Host:     smtp.resend.com
  Port:     465  (SSL)
  User:     resend
  Password: ${hasResend ? '(votre RESEND_API_KEY du .env)' : '⚠️  RESEND_API_KEY manquante dans .env'}
  Sender:   NoviaAI <onboarding@resend.dev>

ÉTAPE 2 — Modèle de courriel
  Supabase → Authentication → Email Templates → Confirm signup
  Subject:  Confirmez votre compte NoviaAI
  Copiez le HTML depuis:
  ${templatePath}

ÉTAPE 3 — URLs (sécurité redirect)
  Supabase → Authentication → URL Configuration
  Site URL:      https://noviaai.ca
  Redirect URLs: https://noviaai.ca/auth/callback.html

═══════════════════════════════════════════════════════════════
RÉSULTAT ATTENDU POUR VOS CLIENTS
═══════════════════════════════════════════════════════════════
  De:      NoviaAI <onboarding@resend.dev>
  Sujet:   Confirmez votre compte NoviaAI
  Bouton:  "Confirmer mon compte NoviaAI"
  Après:   redirection vers https://noviaai.ca/auth/callback.html

Note: le lien technique passe encore par Supabase (sécurité du token).
      C'est normal. L'expéditeur et le design = NoviaAI.

Option avancée (plus tard): domaine auth.noviaai.ca sur Supabase Pro.
`);

if (existsSync(templatePath)) {
  console.log('── Aperçu template (début) ──\n');
  console.log(readFileSync(templatePath, 'utf8').slice(0, 400) + '…\n');
}
