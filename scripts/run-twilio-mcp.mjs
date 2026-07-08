/**
 * Lance @twilio-alpha/mcp en chargeant les clés depuis rattrapeur-sms/.env
 * Format requis: ACCOUNT_SID/API_KEY:API_SECRET
 * Créez une API Key sur console.twilio.com → Account → API keys
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');

const env = {};
if (existsSync(envPath)) {
  readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const i = t.indexOf('=');
    if (i === -1) return;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  });
}

const sid = env.TWILIO_ACCOUNT_SID || process.env.TWILIO_ACCOUNT_SID;
const key = env.TWILIO_API_KEY || process.env.TWILIO_API_KEY;
const secret = env.TWILIO_API_SECRET || process.env.TWILIO_API_SECRET;

if (!sid || !key || !secret) {
  console.error('Manquant dans rattrapeur-sms/.env :');
  if (!sid) console.error('  TWILIO_ACCOUNT_SID');
  if (!key) console.error('  TWILIO_API_KEY  (pas le Auth Token — créez une API Key sur console.twilio.com)');
  if (!secret) console.error('  TWILIO_API_SECRET');
  process.exit(1);
}

const cred = `${sid}/${key}:${secret}`;
const services = env.TWILIO_MCP_SERVICES || process.env.TWILIO_MCP_SERVICES || '';
const args = ['-y', '@twilio-alpha/mcp', cred];
if (services) args.push('--services', services);

const child = spawn('npx', args, {
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});

child.on('exit', (code) => process.exit(code ?? 1));
