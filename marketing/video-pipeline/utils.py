"""Utilitaires communs."""
import json
import logging
import re
import time
from pathlib import Path

import requests

from config import LOGS_DIR, MAX_RETRIES, REQUEST_TIMEOUT, RETRY_BACKOFF


def setup_logging(name: str, log_file: str | None = None) -> logging.Logger:
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger
    logger.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", datefmt="%H:%M:%S")
    sh = logging.StreamHandler()
    sh.setFormatter(fmt)
    logger.addHandler(sh)
    if log_file:
        fh = logging.FileHandler(LOGS_DIR / log_file, encoding="utf-8")
        fh.setFormatter(fmt)
        logger.addHandler(fh)
    return logger


def slug_term(term: str) -> str:
    s = term.strip().lower().replace(" ", "_")
    return re.sub(r"[^a-z0-9_]+", "", s)


def load_json(path: Path, default=None):
    if not path.exists():
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def pexels_get(url: str, api_key: str, params: dict | None = None) -> dict:
    headers = {"Authorization": api_key}
    delay = RETRY_BACKOFF
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = requests.get(url, headers=headers, params=params or {}, timeout=REQUEST_TIMEOUT)
            if r.status_code == 429:
                wait = int(r.headers.get("Retry-After", delay))
                time.sleep(wait)
                delay *= 1.5
                continue
            r.raise_for_status()
            return r.json()
        except requests.RequestException as e:
            if attempt == MAX_RETRIES:
                raise
            time.sleep(delay)
            delay *= 1.5
    raise RuntimeError("pexels_get: échec après retries")


def download_file(url: str, dest: Path, logger: logging.Logger) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    delay = RETRY_BACKOFF
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            with requests.get(url, stream=True, timeout=REQUEST_TIMEOUT) as r:
                r.raise_for_status()
                with open(dest, "wb") as f:
                    for chunk in r.iter_content(chunk_size=1024 * 256):
                        if chunk:
                            f.write(chunk)
            return
        except requests.RequestException as e:
            if dest.exists():
                dest.unlink(missing_ok=True)
            if attempt == MAX_RETRIES:
                raise
            logger.warning("Téléchargement échoué (%s), retry %s/%s", e, attempt, MAX_RETRIES)
            time.sleep(delay)
            delay *= 1.5
