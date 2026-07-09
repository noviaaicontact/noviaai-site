/**
 * Ajoute l'enregistrement MX Resend (send.noviaai.ca) via API Namecheap.
 * Prérequis dans .env (rattrapeur-sms ou noviaai-site) :
 *   NAMECHEAP_API_USER=...
 *   NAMECHEAP_API_KEY=...
 *   NAMECHEAP_CLIENT_IP=...   (IP publique whitelistée dans Namecheap → API Access)
 *
 * Usage: node scripts/namecheap-add-resend-mx.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MX_HOST = 'send';
const MX_SERVER = 'feedback-smtp.us-east-1.amazonses.com';
const MX_PREF = '10';

function loadEnv() {
  const env = {};
  for (const p of [join(root, '.env'), join(root, '..', 'rattrapeur-sms', '.env')]) {
    if (!existsSync(p)) continue;
    readFileSync(p, 'utf8').split(/\r?\n/).forEach((line) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return;
      const i = t.indexOf('=');
      if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    });
  }
  return env;
}

function parseHostsXml(xml) {
  const hosts = [];
  const re = /<Host\s+([^>]+)\/>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = {};
    m[1].replace(/(\w+)="([^"]*)"/g, (_, k, v) => { attrs[k.toLowerCase()] = v; });
    hosts.push({
      Name: attrs.name || '',
      Type: attrs.type || '',
      Address: attrs.address || '',
      MXPref: attrs.mxpref || '10',
      TTL: attrs.ttl || '1799',
    });
  }
  return hosts;
}

async function namecheapApi(command, params, env) {
  const q = new URLSearchParams({
    ApiUser: env.NAMECHEAP_API_USER,
    ApiKey: env.NAMECHEAP_API_KEY,
    UserName: env.NAMECHEAP_API_USER,
    ClientIp: env.NAMECHEAP_CLIENT_IP,
    Command: command,
    ...params,
  });
  const url = `https://api.namecheap.com/xml.response?${q}`;
  const res = await fetch(url);
  const xml = await res.text();
  if (xml.includes('Status="ERROR"')) {
    const err = xml.match(/<Error[^>]*>([^<]+)/)?.[1] || xml.slice(0, 300);
    throw new Error(err);
  }
  return xml;
}

async function main() {
  const env = loadEnv();
  const { NAMECHEAP_API_USER, NAMECHEAP_API_KEY, NAMECHEAP_CLIENT_IP } = env;
  if (!NAMECHEAP_API_USER || !NAMECHEAP_API_KEY || !NAMECHEAP_CLIENT_IP) {
    console.log(`
❌ API Namecheap non configurée.

1. https://ap.www.namecheap.com/settings/tools/apiaccess/ → ON
2. Whitelistez votre IP : ${await fetch('https://api.ipify.org').then((r) => r.text()).catch(() => 'votre IP publique')}
3. Ajoutez dans rattrapeur-sms/.env :
   NAMECHEAP_API_USER=votre_username
   NAMECHEAP_API_KEY=votre_cle
   NAMECHEAP_CLIENT_IP=votre_ip
4. Relancez ce script.
`);
    process.exit(1);
  }

  console.log('\n📡 Namecheap API — ajout MX Resend pour send.noviaai.ca\n');

  const getXml = await namecheapApi('namecheap.domains.dns.getHosts', { SLD: 'noviaai', TLD: 'ca' }, env);
  const hosts = parseHostsXml(getXml);
  console.log(`Enregistrements actuels: ${hosts.length}`);

  const hasMx = hosts.some((h) => h.Name === MX_HOST && h.Type === 'MX');
  if (hasMx) {
    console.log('✅ MX send existe déjà');
    return;
  }

  const all = [...hosts, {
    Name: MX_HOST,
    Type: 'MX',
    Address: MX_SERVER,
    MXPref: MX_PREF,
    TTL: '1799',
  }];

  const params = { SLD: 'noviaai', TLD: 'ca', EmailType: 'MX' };
  all.forEach((h, i) => {
    const n = i + 1;
    params[`HostName${n}`] = h.Name;
    params[`RecordType${n}`] = h.Type;
    params[`Address${n}`] = h.Address;
    params[`TTL${n}`] = h.TTL || '1799';
    if (h.Type === 'MX') params[`MXPref${n}`] = h.MXPref || '10';
  });

  await namecheapApi('namecheap.domains.dns.setHosts', params, env);
  console.log(`✅ MX ajouté: ${MX_HOST} → ${MX_SERVER} (priority ${MX_PREF})`);
  console.log('Attendez 5–15 min puis: npm run resend:prod');
}

main().catch((e) => {
  console.error('❌', e.message || e);
  process.exit(1);
});
