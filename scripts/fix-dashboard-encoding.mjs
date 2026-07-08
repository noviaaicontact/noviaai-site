import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const p = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'dashboard.html');
let s = readFileSync(p, 'utf8');
const pairs = [
  ['Ã \u00a0', 'à '],
  ['Ã ', 'à '],
  ['Ã©', 'é'],
  ['â€"', '—'],
  ['â€"', '—'],
  ['ðŸ˜Š', '😊'],
  ['rÃ©serve', 'réserve'],
  ['âœ"', '✓'],
  ["subscription_status: 'Essai 14 j'", "subscription_status: 'trialing'"],
];
pairs.forEach(([from, to]) => { s = s.split(from).join(to); });
writeFileSync(p, s, 'utf8');
console.log('dashboard encoding fixed');
