#!/usr/bin/env python3
"""
NoviaAI — Pub en 1 clic
Niche + objectif → script + image GPT Image + vidéo Runway 9:16
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import sys
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parent
PIPELINE = ROOT.parent / "video-pipeline"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(PIPELINE))

from pub_pipeline import format_pub, generate_pub_complete  # noqa: E402
from runway_guard import grant_runway_approval  # noqa: E402
from utils import load_secrets_into_env, setup_logging  # noqa: E402

log = setup_logging("pub_app", "pub_app.log")
OUTPUT_DIR = ROOT / "output"
PORT = 8765

NICHES = [
    ("plombier", "Plombier", "Convertir les appels manqués en urgences bookées"),
    ("garage", "Garage mécanique", "Remplir l'horaire avec des RDV qualifiés"),
    ("salon", "Salon de coiffure", "Ne plus perdre de clientes qui appellent"),
    ("electricien", "Électricien", "Capturer les demandes urgentes 24/7"),
]

DEFAULT_PRODUIT = "NoviaAI"
DEFAULT_OBJECTIF = "Convertir les appels manqués en clients payants"


def _safe_print(text: str) -> None:
    try:
        print(text)
    except UnicodeEncodeError:
        print(text.encode("ascii", errors="replace").decode("ascii"))


def run_cli(
    niche: str,
    objectif: str,
    produit: str,
    *,
    with_video: bool = False,
    allow_runway: bool = False,
) -> int:
    load_secrets_into_env()
    if allow_runway:
        grant_runway_approval()
    log.info("Workflow complet : %s / %s", niche, objectif)
    steps = "concept (~20s) + image (~25s)"
    if with_video:
        steps += " + video Runway (~2-5 min, credits)" if allow_runway else " (Runway bloque — ajoutez --allow-runway)"
    print(f"Generation ({niche}) — {steps}")
    pub = generate_pub_complete(
        niche, produit, objectif,
        with_video=with_video,
        allow_runway=allow_runway,
    )
    _safe_print(format_pub(pub))
    print(f"\nImage : {pub['image']['path']}")
    if pub.get("video"):
        print(f"Video : {pub['video']['path']}")
    elif pub.get("video_error"):
        print(f"Video : non generee — {pub['video_error'][:120]}")
    print(f"Dossier : {OUTPUT_DIR / niche.lower()}")
    return 0


WEB_HTML = """<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>NoviaAI — Pub complète</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; max-width: 820px; margin: 0 auto; padding: 24px; background: #0f172a; color: #f8fafc; }
    h1 { font-size: 1.5rem; margin: 0; }
    p.sub { color: #94a3b8; margin: 6px 0 24px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
    .niche-btn {
      padding: 20px 16px; border: 2px solid #334155; border-radius: 14px;
      background: #1e293b; color: #fff; font-size: 1rem; font-weight: 700;
      cursor: pointer; transition: .15s;
    }
    .niche-btn:hover { border-color: #c8f135; background: #243044; }
    .niche-btn:disabled { opacity: .45; cursor: wait; }
    label { display: block; margin-top: 20px; font-weight: 600; font-size: .9rem; color: #94a3b8; }
    input, select { width: 100%; padding: 10px 12px; margin-top: 6px; border-radius: 8px; border: 1px solid #334155; background: #1e293b; color: #fff; font-size: 1rem; }
    .status { margin-top: 20px; padding: 14px; border-radius: 10px; background: #1e293b; color: #94a3b8; display: none; }
    .status.on { display: block; }
    .result { display: none; margin-top: 24px; }
    .result.on { display: block; }
    .media { display: grid; gap: 16px; margin-bottom: 20px; }
    .result video { width: 100%; max-width: 360px; border-radius: 16px; border: 2px solid #334155; display: block; margin: 0 auto; }
    pre { background: #1e293b; padding: 16px; border-radius: 10px; white-space: pre-wrap; font-size: .82rem; line-height: 1.55; overflow-x: auto; }
    .err { color: #f87171; }
  </style>
</head>
<body>
  <h1>Pub complète</h1>
  <p class="sub">Niche → script + image + vidéo 9:16 (OpenAI + Runway)</p>

  <label>Objectif marketing
    <select id="objectif">
      <option value="Convertir les appels manqués en clients payants">Convertir les appels manqués en clients</option>
      <option value="Obtenir des inscriptions à l'essai gratuit 14 jours">Essai gratuit 14 jours</option>
      <option value="Montrer la rapidité du texto automatique (8 secondes)">Texto auto en 8 sec</option>
      <option value="Démontrer l'agent IA qui book des RDV">Agent IA qui book des RDV</option>
    </select>
  </label>

  <label>Produit<input id="produit" value="NoviaAI"/></label>

  <p style="margin-top:24px;font-weight:600;color:#94a3b8;font-size:.9rem">Choisis ta niche</p>
  <div class="grid" id="niches">
    <button type="button" class="niche-btn" data-niche="plombier">Plombier</button>
    <button type="button" class="niche-btn" data-niche="garage">Garage</button>
    <button type="button" class="niche-btn" data-niche="salon">Salon</button>
    <button type="button" class="niche-btn" data-niche="electricien">Électricien</button>
  </div>

  <div class="status" id="status">Génération… concept + image + vidéo Runway (2-5 min)</div>
  <div class="result" id="result">
    <div class="media">
      <video id="previewVideo" controls playsinline></video>
      <img id="preview" alt="Image pub"/>
    </div>
    <pre id="copy"></pre>
  </div>
  <script>
    const status = document.getElementById('status');
    const result = document.getElementById('result');
    const preview = document.getElementById('preview');
    const previewVideo = document.getElementById('previewVideo');
    const copy = document.getElementById('copy');
    const btns = document.querySelectorAll('.niche-btn');

    async function generate(niche) {
      btns.forEach(b => b.disabled = true);
      status.className = 'status on';
      result.className = 'result';
      copy.className = '';
      previewVideo.removeAttribute('src');
      status.textContent = 'Étape 1/3 — concept OpenAI…';
      const body = new URLSearchParams({
        niche,
        produit: document.getElementById('produit').value,
        objectif: document.getElementById('objectif').value,
      });
      try {
        const r = await fetch('/generate', { method: 'POST', body });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || r.statusText);
        status.className = 'status';
        result.className = 'result on';
        preview.src = j.image_url + '?t=' + Date.now();
        if (j.video_url) {
          previewVideo.src = j.video_url + '?t=' + Date.now();
          previewVideo.style.display = 'block';
        } else {
          previewVideo.style.display = 'none';
        }
        copy.textContent = j.text;
      } catch (err) {
        status.className = 'status on err';
        status.textContent = 'Erreur : ' + err.message;
      }
      btns.forEach(b => b.disabled = false);
    }

    btns.forEach(b => b.addEventListener('click', () => generate(b.dataset.niche)));
  </script>
</body>
</html>"""


def run_web(port: int = PORT) -> int:
    load_secrets_into_env()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            log.info(fmt % args)

        def do_GET(self):
            path = urlparse(self.path).path
            if path in ("/", "/index.html"):
                self._html(WEB_HTML)
                return
            if path.startswith("/files/"):
                rel = unquote(path[len("/files/"):])
                file_path = (OUTPUT_DIR / rel).resolve()
                if not str(file_path).startswith(str(OUTPUT_DIR.resolve())):
                    self.send_error(403)
                    return
                if not file_path.is_file():
                    self.send_error(404)
                    return
                mime = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
                data = file_path.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", mime)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            self.send_error(404)

        def do_POST(self):
            if urlparse(self.path).path != "/generate":
                self.send_error(404)
                return
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length).decode("utf-8")
            data = parse_qs(body)
            niche = (data.get("niche") or [""])[0].strip()
            produit = (data.get("produit") or [DEFAULT_PRODUIT])[0].strip()
            objectif = (data.get("objectif") or [DEFAULT_OBJECTIF])[0].strip()
            if not niche:
                self._json(400, {"error": "Niche requise"})
                return
            try:
                pub = generate_pub_complete(niche, produit, objectif)
                img_rel = Path(pub["image"]["latest_path"]).relative_to(OUTPUT_DIR.resolve())
                resp = {
                    "text": format_pub(pub),
                    "pub": pub,
                    "image_url": f"/files/{img_rel.as_posix()}",
                }
                if pub.get("video"):
                    vid_rel = Path(pub["video"]["latest_path"]).relative_to(OUTPUT_DIR.resolve())
                    resp["video_url"] = f"/files/{vid_rel.as_posix()}"
                self._json(200, resp)
            except Exception as ex:
                log.exception("Erreur: %s", ex)
                self._json(500, {"error": str(ex)})

        def _html(self, html: str):
            data = html.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(data)

        def _json(self, code: int, obj: dict):
            payload = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(payload)

    url = f"http://127.0.0.1:{port}/"
    print(f"Interface : {url}")
    webbrowser.open(url)
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="NoviaAI — Pub en 1 clic")
    parser.add_argument("--niche", help="Niche (CLI)")
    parser.add_argument("--produit", default=DEFAULT_PRODUIT)
    parser.add_argument("--objectif", default=DEFAULT_OBJECTIF)
    parser.add_argument("--with-video", action="store_true", help="Tenter video Runway (requiert --allow-runway)")
    parser.add_argument(
        "--allow-runway",
        action="store_true",
        help="APPROUVER consommation credits Runway",
    )
    parser.add_argument("--web", action="store_true", help="Interface web")
    parser.add_argument("--port", type=int, default=PORT)
    args = parser.parse_args()

    try:
        if args.niche:
            return run_cli(
                args.niche, args.objectif, args.produit,
                with_video=args.with_video,
                allow_runway=args.allow_runway,
            )
        return run_web(args.port)
    except Exception as e:
        log.exception("Echec: %s", e)
        print(f"Erreur : {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
