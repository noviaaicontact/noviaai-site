/**
 * Lance @stripe/mcp en chargeant STRIPE_SECRET_KEY depuis rattrapeur-sms/.env
 * (Cursor MCP ne lit pas automatiquement le .env du projet)
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');

if (existsSync(envPath)) {
  readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const i = t.indexOf('=');
    if (i === -1) return;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (k === 'STRIPE_SECRET_KEY' && v) process.env.STRIPE_SECRET_KEY = v;
  });
}

if (!process.env.STRIPE_SECRET_KEY) {
  console.error('STRIPE_SECRET_KEY introuvable dans rattrapeur-sms/.env');
  process.exit(1);
}

const child = spawn('npx', ['-y', '@stripe/mcp'], {
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});

child.on('exit', (code) => process.exit(code ?? 1));
