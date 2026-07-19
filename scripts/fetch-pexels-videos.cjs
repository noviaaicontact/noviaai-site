#!/usr/bin/env node
/**
 * Télécharge des vidéos Pexels pour les pubs NoviaAI.
 *
 * 1. Clé gratuite : https://www.pexels.com/api/ → ajoutez PEXELS_API_KEY dans .env
 * 2. node scripts/fetch-pexels-videos.cjs
 *
 * Sortie : marketing/pubs-noviaai/videos/download/
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

function loadEnv() {
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

loadEnv();

const API_KEY = process.env.PEXELS_API_KEY;
const OUT_DIR = path.join(__dirname, '..', 'marketing', 'pubs-noviaai', 'videos', 'download');
const CURATED = path.join(__dirname, '..', 'marketing', 'pubs-noviaai', 'videos-curated.json');

const SEARCHES = [
  'missed phone call',
  'frustrated phone office',
  'mechanic phone workshop',
  'phone notification message',
  'texting smartphone close up',
  'busy small business owner',
  'customer service phone headset',
  'hair salon worker',
];

function fetchJson(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', reject);
  });
}

function pickBestFile(video) {
  const files = video.video_files || [];
  const hd = files
    .filter((f) => f.file_type === 'video/mp4')
    .sort((a, b) => (b.height || 0) - (a.height || 0));
  const pick = hd.find((f) => f.height && f.height <= 1080) || hd[0];
  return pick;
}

async function fetchVideoById(id) {
  const url = `https://api.pexels.com/v1/videos/videos/${id}`;
  const data = await fetchJson(url, { Authorization: API_KEY });
  return data;
}

async function searchVideos(query, perPage) {
  const q = encodeURIComponent(query);
  const url = `https://api.pexels.com/v1/videos/search?query=${q}&per_page=${perPage}&orientation=landscape`;
  const data = await fetchJson(url, { Authorization: API_KEY });
  return data.videos || [];
}

async function main() {
  if (!API_KEY) {
    console.error('PEXELS_API_KEY manquante.');
    console.error('1. Allez sur https://www.pexels.com/api/');
    console.error('2. Créez une clé gratuite');
    console.error('3. Ajoutez PEXELS_API_KEY=votre_cle dans noviaai-site/.env');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifest = { downloaded: [], skipped: [], errors: [] };
  const seen = new Set();

  const curated = JSON.parse(fs.readFileSync(CURATED, 'utf8'));
  const curatedIds = curated.videos.map((v) => v.id);

  console.log('=== Vidéos curées (' + curatedIds.length + ') ===');
  for (const id of curatedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    try {
      const data = await fetchVideoById(id);
      const video = data;
      const file = pickBestFile(video);
      if (!file) {
        manifest.skipped.push({ id, reason: 'no mp4' });
        continue;
      }
      const meta = curated.videos.find((v) => v.id === id);
      const safeName = `${id}-${(meta?.title || video.url || 'video').slice(0, 40).replace(/[^\w\-]+/g, '-')}.mp4`;
      const dest = path.join(OUT_DIR, safeName);
      if (fs.existsSync(dest)) {
        console.log('Skip (exists):', safeName);
        manifest.skipped.push({ id, file: safeName, reason: 'exists' });
        continue;
      }
      console.log('Download:', safeName);
      await downloadFile(file.link, dest);
      manifest.downloaded.push({
        id,
        file: safeName,
        title: meta?.title || '',
        pexels_url: meta?.url || video.url,
        scene: meta?.scene || '',
      });
    } catch (e) {
      console.error('Error', id, e.message);
      manifest.errors.push({ id, error: e.message });
    }
  }

  console.log('\n=== Recherches bonus (5 par requête) ===');
  for (const query of SEARCHES) {
    try {
      const videos = await searchVideos(query, 5);
      for (const video of videos) {
        if (seen.has(video.id)) continue;
        seen.add(video.id);
        const file = pickBestFile(video);
        if (!file) continue;
        const safeName = `${video.id}-${query.replace(/\s+/g, '-')}.mp4`;
        const dest = path.join(OUT_DIR, safeName);
        if (fs.existsSync(dest)) continue;
        console.log('Download:', safeName);
        await downloadFile(file.link, dest);
        manifest.downloaded.push({
          id: video.id,
          file: safeName,
          title: query,
          pexels_url: video.url,
          scene: 'search',
        });
      }
    } catch (e) {
      manifest.errors.push({ query, error: e.message });
    }
  }

  const manifestPath = path.join(OUT_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log('\nTerminé:', manifest.downloaded.length, 'fichiers →', OUT_DIR);
  console.log('Manifest:', manifestPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
