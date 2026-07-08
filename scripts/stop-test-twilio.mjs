/**
 * Arrête netlify dev + tunnel lancés par start-test-twilio.mjs
 */
import { readFileSync, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const logPath = join(root, '.test-twilio-pids.txt');

function killPid(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGTERM');
    }
    console.log('✅ Arrêté PID', pid);
  } catch {
    console.log('⚠️  PID', pid, 'déjà arrêté');
  }
}

if (!existsSync(logPath)) {
  console.log('Aucune session test active (.test-twilio-pids.txt absent)');
  process.exit(0);
}

const lines = Object.fromEntries(
  readFileSync(logPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => l.split('=')),
);
killPid(lines.netlify_pid);
killPid(lines.tunnel_pid);
unlinkSync(logPath);
console.log('Session test terminée.');
