/**
 * Démo vidéo Playwright — simulation 100 % visuelle (sans login, sans webhooks)
 *
 * Prérequis : serveur local sur :8888
 *   npm run dev   (dans noviaai-site)
 *   ou : npx serve . -p 8888
 *
 * Usage : npm run demo:video
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, unlinkSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import http from 'http';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(root, 'marketing', 'demo-videos');

const DEMO_PHONE = '+1 (418) 555-9021';
const SMS_RATTRAPAGE = 'Bonjour! Ici Léa, de Plomberie Tremblay. Désolé, on a manqué votre appel! Répondez à ce texto.';
const SMS_CLIENT = 'Fuite sous l\'évier, c\'est urgent!';
const SMS_IA = 'Parfait! Disponible demain 8 h? Répondez OUI pour confirmer le RDV.';

/** iPhone 14 Pro — capture native pour pubs verticales */
const MOBILE_W = 390;
const MOBILE_H = 844;

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForServer(url, maxMs = 60000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) resolve(true);
        else retry();
      }).on('error', retry);
    };
    const retry = () => {
      if (Date.now() - start > maxMs) reject(new Error(`Serveur inaccessible : ${url}`));
      else setTimeout(tick, 1500);
    };
    tick();
  });
}

function hasFfmpeg() {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function toMp4(webmPath, mp4Path) {
  execSync(
    `ffmpeg -y -i "${webmPath}" -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p "${mp4Path}"`,
    { stdio: 'inherit' },
  );
}

async function showBanner(page, text, sub = '') {
  await page.evaluate(({ text, sub }) => {
    let el = document.getElementById('playwright-demo-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'playwright-demo-banner';
      el.style.cssText = [
        'position:fixed', 'top:24px', 'left:50%', 'transform:translateX(-50%)',
        'z-index:99999', 'background:#0f172a', 'color:#fff', 'padding:16px 28px',
        'border-radius:12px', 'font-family:system-ui,sans-serif', 'font-size:1.05rem',
        'box-shadow:0 8px 32px rgba(0,0,0,.35)', 'text-align:center', 'max-width:90vw',
      ].join(';');
      document.body.appendChild(el);
    }
    el.innerHTML = `<strong>${text}</strong>${sub ? `<div style="opacity:.85;font-size:.9rem;margin-top:6px">${sub}</div>` : ''}`;
  }, { text, sub });
}

async function hideDemoBanner(page) {
  await page.evaluate(() => {
    const b = document.getElementById('demoBanner');
    if (b) b.style.display = 'none';
  });
}

async function resetInbox(page) {
  await page.evaluate(() => {
    const list = document.getElementById('inboxList');
    const thread = document.getElementById('inboxThread');
    if (list) list.innerHTML = '<div class="inbox-empty">Aucune conversation.<br>En attente d\'un appel…</div>';
    if (thread) thread.innerHTML = '<div class="inbox-empty">Sélectionnez une conversation</div>';
    const missed = document.getElementById('missedCount');
    if (missed) missed.textContent = '0';
  });
}

async function addInboxItem(page, phone, preview, missedCalls = 1) {
  await page.evaluate(({ phone, preview, missedCalls }) => {
    const list = document.getElementById('inboxList');
    if (!list) return;
    list.innerHTML = `<div class="inbox-item active" data-phone="${phone}">
      <div class="phone">${phone}</div>
      <div class="preview">${preview}</div>
      <div class="meta"><span class="inbox-badge">${missedCalls} appel(s)</span><span>À l'instant</span></div>
    </div>`;
    const missed = document.getElementById('missedCount');
    if (missed) missed.textContent = String(missedCalls);
  }, { phone, preview, missedCalls });
}

async function appendBubble(page, direction, body, label) {
  await page.evaluate(({ direction, body, label }) => {
    const thread = document.getElementById('inboxThread');
    if (!thread) return;
    const empty = thread.querySelector('.inbox-empty');
    if (empty) thread.innerHTML = '';
    const cls = direction === 'inbound' ? 'in' : 'out';
    const who = label || (direction === 'inbound' ? 'Client' : 'NoviaAI');
    const when = new Date().toLocaleString('fr-CA', { dateStyle: 'short', timeStyle: 'short' });
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const div = document.createElement('div');
    div.className = `inbox-bubble ${cls}`;
    div.style.opacity = '0';
    div.style.transform = 'translateY(8px)';
    div.style.transition = 'opacity .4s ease, transform .4s ease';
    div.innerHTML = `<small class="muted">${esc(who)} · ${when}</small><br>${esc(body)}`;
    thread.appendChild(div);
    requestAnimationFrame(() => {
      div.style.opacity = '1';
      div.style.transform = 'translateY(0)';
    });
    thread.scrollTop = thread.scrollHeight;
  }, { direction, body, label });
}

async function hidePlaywrightBanner(page) {
  await page.evaluate(() => {
    const el = document.getElementById('playwright-demo-banner');
    if (el) el.style.display = 'none';
  });
}

async function pulseStat(page, id) {
  await page.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.transition = 'transform .3s ease';
    el.style.transform = 'scale(1.15)';
    setTimeout(() => { el.style.transform = 'scale(1)'; }, 300);
  }, id);
}

async function main() {
  const base = (process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:8888').replace(/\/$/, '');

  console.log('\n=== NoviaAI — démo vidéo simulée (sans login) ===\n');
  console.log('URL :', `${base}/conversations.html?demo=1`);

  console.log('Vérification serveur…');
  try {
    await waitForServer(`${base}/conversations.html`);
    console.log('✅ Serveur actif\n');
  } catch (e) {
    console.error(`❌ ${e.message}`);
    console.error('   Lancez : npm run dev  (dans noviaai-site)');
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const mp4Path = join(OUT_DIR, `demo-appel-manque-${stamp}.mp4`);

  const browser = await chromium.launch({ headless: false, slowMo: 80 });
  const context = await browser.newContext({
    viewport: { width: MOBILE_W, height: MOBILE_H },
    recordVideo: { dir: OUT_DIR, size: { width: MOBILE_W, height: MOBILE_H } },
    locale: 'fr-CA',
    isMobile: true,
    hasTouch: true,
  });

  const page = await context.newPage();
  let videoSaved = false;

  try {
    await page.goto(`${base}/conversations.html?demo=1`);
    await page.waitForSelector('#inboxList', { timeout: 20000 });
    await wait(1000);
    await hideDemoBanner(page);
    await resetInbox(page);

    // Intro courte
    await showBanner(page, '📞 Appel manqué', `${DEMO_PHONE}`);
    await pulseStat(page, 'missedCount');
    await wait(2200);
    await hidePlaywrightBanner(page);

    // Conversation — sans bannière, temps allongé
    await addInboxItem(page, DEMO_PHONE, 'SMS de rattrapage envoyé…', 1);
    await page.click('.inbox-item');
    await wait(1200);
    await appendBubble(page, 'outbound', SMS_RATTRAPAGE, 'NoviaAI · SMS rattrapage');
    await wait(4500);

    await addInboxItem(page, DEMO_PHONE, SMS_CLIENT.slice(0, 40) + '…', 1);
    await wait(1500);
    await appendBubble(page, 'inbound', SMS_CLIENT, 'Client');
    await wait(5000);

    await appendBubble(page, 'outbound', SMS_IA, 'NoviaAI · Agent IA');
    await addInboxItem(page, DEMO_PHONE, 'RDV demain 8 h — confirmé', 1);
    await wait(6500);

    // Pause finale sur la conversation complète
    await wait(5000);
  } finally {
    const video = page.video();
    await context.close();
    await browser.close();

    if (video) {
      const rawPath = await video.path();
      if (existsSync(rawPath)) {
        if (hasFfmpeg()) {
          console.log('\nConversion MP4…');
          toMp4(rawPath, mp4Path);
          try { unlinkSync(rawPath); } catch { /* ignore */ }
          console.log(`\n✅ Vidéo MP4 : ${mp4Path}\n`);
          videoSaved = true;
        } else {
          const webmFinal = join(OUT_DIR, `demo-appel-manque-${stamp}.webm`);
          renameSync(rawPath, webmFinal);
          console.log(`\n✅ Vidéo WebM : ${webmFinal}`);
          console.log('   (Installez ffmpeg pour MP4)\n');
          videoSaved = true;
        }
      }
    }
  }

  if (!videoSaved) {
    console.error('❌ Vidéo non sauvegardée');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('\n❌', e.message || e);
  process.exit(1);
});
