#!/usr/bin/env python3
"""
Générateur de publicités NoviaAI — OpenAI

Entrées : niche, produit/offre, plateforme sociale
Sorties : hook, script 30s, texte à l'écran, description, prompt image, prompt vidéo

Usage :
  python generate_ad.py --niche plombier --produit NoviaAI --plateforme TikTok
  python generate_ad.py --web
"""
from __future__ import annotations

import argparse
import json
import sys
import webbrowser
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
PIPELINE = ROOT.parent / "video-pipeline"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(PIPELINE))

from openai_ad import generate_ad  # noqa: E402
from utils import load_secrets_into_env, setup_logging  # noqa: E402

log = setup_logging("ad_generator", "ad_generator.log")
OUTPUT_DIR = ROOT / "output"


def slugify(*parts: str) -> str:
    raw = "_".join(p.strip().lower() for p in parts if p.strip())
    out = []
    for ch in raw:
        if ch.isalnum():
            out.append(ch)
        elif ch in " -_":
            out.append("_")
    s = "".join(out)
    while "__" in s:
        s = s.replace("__", "_")
    return s.strip("_") or "pub"


def format_text(ad: dict) -> str:
    lines = [
        f"=== PUBLICITÉ {ad['meta']['produit']} — {ad['meta']['niche']} ({ad['meta']['plateforme']}) ===",
        "",
        "HOOK",
        ad["hook"],
        "",
        "SCRIPT 30 SECONDES",
        ad["script_30s"],
        "",
        "TEXTE À L'ÉCRAN",
    ]
    for i, t in enumerate(ad["texte_ecran"], 1):
        lines.append(f"  {i}. {t}")
    lines += [
        "",
        "DESCRIPTION",
        ad["description"],
        "",
        "PROMPT IMAGE",
        ad["prompt_image"],
        "",
        "PROMPT VIDÉO",
        ad["prompt_video"],
        "",
    ]
    return "\n".join(lines)


def save_ad(ad: dict) -> tuple[Path, Path]:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    base = slugify(ad["meta"]["niche"], ad["meta"]["plateforme"])
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    json_path = OUTPUT_DIR / f"{base}_{ts}.json"
    txt_path = OUTPUT_DIR / f"{base}_{ts}.txt"
    latest_json = OUTPUT_DIR / f"{base}_LATEST.json"
    latest_txt = OUTPUT_DIR / f"{base}_LATEST.txt"

    payload = json.dumps(ad, ensure_ascii=False, indent=2)
    json_path.write_text(payload, encoding="utf-8")
    latest_json.write_text(payload, encoding="utf-8")
    txt_path.write_text(format_text(ad), encoding="utf-8")
    latest_txt.write_text(format_text(ad), encoding="utf-8")
    return json_path, txt_path


def run_cli(niche: str, produit: str, plateforme: str) -> int:
    load_secrets_into_env()
    log.info("Génération : niche=%s produit=%s plateforme=%s", niche, produit, plateforme)
    ad = generate_ad(niche, produit, plateforme)
    json_path, txt_path = save_ad(ad)
    text = format_text(ad)
    print(text)
    print(f"\nOK Sauvegarde :\n  {json_path}\n  {txt_path}")
    return 0


WEB_HTML = """<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>NoviaAI — Générateur de pub</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; max-width: 720px; margin: 0 auto; padding: 24px; background: #0f172a; color: #f8fafc; }
    h1 { font-size: 1.4rem; margin-bottom: 4px; }
    p.sub { color: #94a3b8; margin-top: 0; }
    label { display: block; margin-top: 16px; font-weight: 600; font-size: 0.9rem; }
    input, select { width: 100%; padding: 10px 12px; margin-top: 6px; border-radius: 8px; border: 1px solid #334155; background: #1e293b; color: #fff; font-size: 1rem; }
    button { margin-top: 24px; width: 100%; padding: 14px; background: #c8f135; color: #0f172a; border: none; border-radius: 10px; font-weight: 700; font-size: 1rem; cursor: pointer; }
    button:disabled { opacity: 0.5; cursor: wait; }
    pre { background: #1e293b; padding: 16px; border-radius: 10px; overflow-x: auto; white-space: pre-wrap; font-size: 0.85rem; line-height: 1.5; margin-top: 24px; }
    .err { color: #f87171; }
  </style>
</head>
<body>
  <h1>Générateur de publicité</h1>
  <p class="sub">OpenAI → hook, script, textes, prompts image/vidéo</p>
  <form id="f">
    <label>Niche<input name="niche" value="plombier" required/></label>
    <label>Produit / offre<input name="produit" value="NoviaAI" required/></label>
    <label>Plateforme
      <select name="plateforme">
        <option>TikTok</option><option>Facebook</option><option>Instagram</option>
        <option>YouTube</option><option>LinkedIn</option>
      </select>
    </label>
    <button type="submit" id="btn">Générer la pub</button>
  </form>
  <pre id="out" hidden></pre>
  <script>
    const f = document.getElementById('f');
    const out = document.getElementById('out');
    const btn = document.getElementById('btn');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      btn.disabled = true;
      out.hidden = false;
      out.className = '';
      out.textContent = 'Génération en cours… (15-30 s)';
      const body = new URLSearchParams(new FormData(f));
      try {
        const r = await fetch('/generate', { method: 'POST', body });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || r.statusText);
        out.textContent = j.text;
      } catch (err) {
        out.className = 'err';
        out.textContent = 'Erreur : ' + err.message;
      }
      btn.disabled = false;
    });
  </script>
</body>
</html>"""


def run_web(port: int = 8765) -> int:
    load_secrets_into_env()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            log.info(fmt % args)

        def do_GET(self):
            if self.path in ("/", "/index.html"):
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(WEB_HTML.encode("utf-8"))
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
            produit = (data.get("produit") or [""])[0].strip()
            plateforme = (data.get("plateforme") or [""])[0].strip()
            if not niche or not produit or not plateforme:
                self._json(400, {"error": "Champs requis manquants"})
                return
            try:
                ad = generate_ad(niche, produit, plateforme)
                save_ad(ad)
                self._json(200, {"text": format_text(ad), "ad": ad})
            except Exception as ex:
                log.exception("Erreur web: %s", ex)
                self._json(500, {"error": str(ex)})

        def _json(self, code: int, obj: dict):
            payload = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    url = f"http://127.0.0.1:{port}/"
    log.info("Interface web : %s", url)
    print(f"Interface web : {url}")
    webbrowser.open(url)
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Générateur de publicités NoviaAI (OpenAI)")
    parser.add_argument("--niche", default="plombier", help="Niche cible (ex: plombier)")
    parser.add_argument("--produit", default="NoviaAI", help="Produit ou offre")
    parser.add_argument("--plateforme", default="TikTok", help="Plateforme sociale")
    parser.add_argument("--web", action="store_true", help="Lancer l'interface web")
    parser.add_argument("--port", type=int, default=8765, help="Port interface web")
    args = parser.parse_args()

    try:
        if args.web:
            return run_web(args.port)
        return run_cli(args.niche, args.produit, args.plateforme)
    except Exception as e:
        log.exception("Échec: %s", e)
        print(f"Erreur : {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
