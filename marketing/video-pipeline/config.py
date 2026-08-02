"""Configuration partagée du pipeline vidéo NoviaAI."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent

CLIPS_DIR = ROOT / "clips"
LOCAL_CLIPS_DIR = CLIPS_DIR / "local"
SELECTION_DIR = ROOT / "selection"
PUBS_DIR = ROOT / "pubs"
LOGS_DIR = ROOT / "logs"
STATE_FILE = ROOT / ".pipeline_state.json"

CLIPS_JSON = ROOT / "clips.json"
SELECTION_JSON = ROOT / "selection.json"
SCRIPTS_JSON = ROOT / "scripts.json"

# Scènes narratives — mots-clés Pexels par étape de l'histoire
SCENE_CATALOG: dict[str, list[str]] = {
    # Plan 1 : le client appelle, personne ne répond
    "call": [
        "woman calling phone",
        "man calling smartphone",
        "phone ringing table",
    ],
    # Plan 2 : le commerçant est occupé, impossible de décrocher
    "busy": [
        "plumber repair pipes",
        "plumber working tools",
        "plumber fixing faucet",
        "mechanic under car hood",
        "electrician working wires",
        "construction worker busy",
        "garage mechanic working",
        "hair stylist cutting hair",
    ],
    # Plan 3 : le client reçoit le texto du commerce
    "sms": [
        "text message phone screen",
        "smartphone notification message",
        "woman reading text message",
        "man texting phone smile",
    ],
    # Plan 4 : dénouement — bonne nouvelle, RDV booké
    "result": [
        "handshake customer shop",
        "happy customer phone",
        "contractor phone smile",
        "small business owner phone",
        "happy woman salon mirror",
    ],
}

SEARCH_TERMS = [term for terms in SCENE_CATALOG.values() for term in terms]

CLIPS_PER_TERM = 4
TOP_PER_SCENE = 4
PUB_COUNT = 20

# Filtres Pexels / téléchargement
MIN_DURATION = 5
MAX_DURATION = 20
MAX_HEIGHT = 1080
ORIENTATION = "portrait"

# Format pub finale (4 plans = ~25 s)
PUB_WIDTH = 1080
PUB_HEIGHT = 1920
PUB_FPS = 30
PUB_DURATION = 25.0

# Durée par plan (secondes) — doit totaliser PUB_DURATION
PLAN_DURATIONS = (4, 6, 8, 7)

PEXELS_SEARCH_URL = "https://api.pexels.com/v1/videos/search"
PEXELS_VIDEO_URL = "https://api.pexels.com/v1/videos/videos/{id}"

UNSPLASH_JSON = ROOT / "unsplash.json"
IMAGES_PER_TERM = 3

# Photos Unsplash (portrait) — complète Pexels pour plans « problème »
UNSPLASH_CATALOG: dict[str, list[str]] = {
    "busy": [
        "plumber under sink",
        "plumber repair pipes",
        "mechanic under car hood",
        "electrician working",
        "construction worker tools",
    ],
    "call": [
        "phone ringing missed call",
        "smartphone notification",
        "tradesperson phone",
    ],
    "result": [
        "handshake contractor",
        "small business owner smile",
        "plumber customer",
    ],
}

REQUEST_TIMEOUT = 60
MAX_RETRIES = 5
RETRY_BACKOFF = 2.0
