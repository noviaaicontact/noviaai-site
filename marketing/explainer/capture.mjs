/**
 * Capture des écrans réels du SaaS NoviaAI pour la vidéo explicative.
 *
 * Lit storyboard.json, produit shots/<id>.png en 2x + shots/manifest.json.
 * Prérequis : serveur statique sur http://127.0.0.1:8888 (racine = noviaai-site).
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = join(HERE, 'shots');
const board = JSON.parse(readFileSync(join(HERE, 'storyboard.json'), 'utf8'));

const SCALE = 2;

/** CSS injecté partout : on retire ce qui parasite une capture produit. */
const CLEAN_CSS = `
  #demoBanner { display: none !important; }
  .sticky-vente { display: none !important; }
  ::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
  * { scrollbar-width: none !important; }
  *, *::before, *::after {
    animation-duration: 0s !important;
    transition-duration: 0s !important;
  }
`;

async function openPage(browser, url, viewport) {
  const page = await browser.newPage({
    viewport: viewport || { width: board.width, height: board.height },
    deviceScaleFactor: SCALE,
    locale: 'fr-CA',
    timezoneId: 'America/Toronto',
  });
  await page.goto(board.baseUrl + url, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
  await page.addStyleTag({ content: CLEAN_CSS });
  return page;
}

function locate(page, shot) {
  let loc = page.locator(shot.selector);
  if (shot.matchText) loc = loc.filter({ hasText: shot.matchText });
  return loc.first();
}

async function shootElement(page, shot, outPath) {
  const loc = locate(page, shot);
  await loc.waitFor({ state: 'visible', timeout: 20000 });
  await loc.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await loc.screenshot({ path: outPath });
}

/** Conversation jouée dans le simulateur de client du tableau de bord. */
async function scenarioClientSim(page, manifest) {
  const card = page.locator('#clientSimCard');
  await card.waitFor({ state: 'visible', timeout: 20000 });
  await card.scrollIntoViewIfNeeded();

  // Hauteur figée : sinon le téléphone grandit à chaque message et le fondu
  // entre deux états fait apparaître le texte en double.
  await page.addStyleTag({
    content: '#simMsgs { height: 330px !important; overflow-y: hidden !important; }',
  });
  await page.waitForTimeout(600);

  const phone = page.locator('.client-sim-phone');
  const settled = async (expected) => {
    await page.waitForFunction(
      (n) => {
        const all = document.querySelectorAll('#simMsgs .client-sim-bubble');
        const typing = document.querySelector('#simMsgs .client-sim-bubble.typing');
        return all.length >= n && !typing;
      },
      expected,
      { timeout: 20000 },
    );
    await page.evaluate(() => {
      const el = document.getElementById('simMsgs');
      if (el) el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(500);
  };

  await settled(1);
  await phone.screenshot({ path: join(SHOTS_DIR, 'sim_1.png') });
  manifest.push({ id: 'sim_1', file: 'sim_1.png' });

  const turns = [
    { text: "Bonjour, c'est combien pour une coupe femme?", expect: 3, id: 'sim_2' },
    { text: 'Est-ce que vous êtes ouverts demain?', expect: 5, id: 'sim_3' },
  ];

  for (const turn of turns) {
    await page.fill('#simInput', turn.text);
    await page.waitForTimeout(300);
    await page.click('#simSend');
    await settled(turn.expect);
    await phone.screenshot({ path: join(SHOTS_DIR, `${turn.id}.png`) });
    manifest.push({ id: turn.id, file: `${turn.id}.png` });
  }
}

async function main() {
  rmSync(SHOTS_DIR, { recursive: true, force: true });
  mkdirSync(SHOTS_DIR, { recursive: true });

  const browser = await chromium.launch();
  const manifest = [];

  for (const shot of board.shots) {
    process.stdout.write(`  → ${shot.id} … `);
    const page = await openPage(browser, shot.url, shot.viewport);
    if (shot.wait) await page.waitForTimeout(shot.wait);

    try {
      if (shot.mode === 'scenario' && shot.scenario === 'clientSim') {
        await scenarioClientSim(page, manifest);
        console.log('ok (3 images)');
      } else if (shot.mode === 'element') {
        const out = join(SHOTS_DIR, `${shot.id}.png`);
        await shootElement(page, shot, out);
        manifest.push({ id: shot.id, file: `${shot.id}.png` });
        console.log('ok');
      } else {
        // Certaines pages se placent toutes seules (focus d'un champ) — on recadre en haut.
        await page.evaluate(() => {
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
          window.scrollTo(0, 0);
        });
        await page.waitForTimeout(400);
        const out = join(SHOTS_DIR, `${shot.id}.png`);
        await page.screenshot({ path: out });
        manifest.push({ id: shot.id, file: `${shot.id}.png` });
        console.log('ok');
      }
    } catch (err) {
      console.log(`ÉCHEC — ${err.message.split('\n')[0]}`);
    }
    await page.close();
  }

  await browser.close();
  writeFileSync(join(SHOTS_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`\n${manifest.length} images dans ${SHOTS_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
