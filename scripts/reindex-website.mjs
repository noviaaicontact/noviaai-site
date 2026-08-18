#!/usr/bin/env node
/**
 * Recrawl le site d'un commerce dans la base de connaissances.
 * Usage: node scripts/reindex-website.mjs <tenantId> [url]
 */
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPaths = [join(root, '.env'), join(root, '..', 'rattrapeur-sms', '.env')];

for (const p of envPaths) {
  if (!existsSync(p)) continue;
  readFileSync(p, 'utf8').split(/\r?\n/).forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const i = t.indexOf('=');
    if (i === -1) return;
    const k = t.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = t.slice(i + 1).trim();
  });
}

const tenantId = process.argv[2];
const urlArg = process.argv[3];
if (!tenantId) {
  console.error('Usage: node scripts/reindex-website.mjs <tenantId> [url]');
  process.exit(1);
}

const SANSOUCI_EXTRA = [
  'https://www.spasetpiscines.com/contact/',
  'https://www.spasetpiscines.com/services/',
  'https://www.spasetpiscines.com/categorie-produit/produits-chimiques/',
  'https://www.spasetpiscines.com/categorie-produit/accessoires/',
  'https://www.spasetpiscines.com/categorie-produit/equipements/',
  'https://www.spasetpiscines.com/categorie-produit/spas/',
  'https://www.spasetpiscines.com/categorie-produit/piscines-hors-terre/',
  'https://www.spasetpiscines.com/categorie-produit/piscines-creusees/',
  'https://www.spasetpiscines.com/categorie-produit/thermopompes/',
  'https://www.spasetpiscines.com/analyse-de-leau-des-spas-et-piscines/',
  'https://www.spasetpiscines.com/ouverture-et-fermeture-de-piscines-et-spas/',
  'https://www.spasetpiscines.com/livraison-et-installation-de-spas-et-piscines/',
  'https://www.spasetpiscines.com/soumission-spas/',
  'https://www.spasetpiscines.com/soumission-piscines-hors-terre/',
  'https://www.spasetpiscines.com/soumission-piscines-creusees/',
  'https://www.spasetpiscines.com/shop/',
  'https://www.spasetpiscines.com/promo/',
];

const { ingestWebsite } = require('../lib/knowledge.js');
const { getAdmin } = require('../lib/db.js');

const db = getAdmin();
if (!db) {
  console.error('Supabase non configuré (.env)');
  process.exit(1);
}

const { data: tenant, error } = await db
  .from('tenants')
  .select('id, business_name, website_url')
  .eq('id', tenantId)
  .single();
if (error || !tenant) {
  console.error('Tenant introuvable', error && error.message);
  process.exit(1);
}

const url = urlArg || tenant.website_url;
if (!url) {
  console.error('Pas d’URL de site');
  process.exit(1);
}

const extraUrls = /spasetpiscines/i.test(url) ? SANSOUCI_EXTRA : [];
console.log(`Indexation de ${tenant.business_name} → ${url}`);

const result = await ingestWebsite(tenant.id, url, {
  maxPages: 20,
  replace: true,
  extraUrls,
});
console.log(JSON.stringify(result, null, 2));
