# Pipeline vidéo NoviaAI

Pipeline **100 % local** pour produire des pubs vidéo verticales (1080×1920) destinées aux PME québécoises — plombiers, électriciens, garagistes, rénovation.

Aucun service payant requis, sauf la clé API **gratuite** Pexels pour télécharger des clips stock.

## Prérequis

- **Python 3.10+**
- **FFmpeg** (installé automatiquement via `imageio-ffmpeg`, ou en local dans le PATH)
- Clé API Pexels gratuite : [https://www.pexels.com/api/](https://www.pexels.com/api/)

### Optionnel — détection de texte incrusté

Pour une meilleure détection de sous-titres/watermarks dans les clips stock :

1. Installez [Tesseract OCR](https://github.com/tesseract-ocr/tesseract)
2. Décommentez `pytesseract` dans `requirements.txt` et réinstallez

Sans Tesseract, une heuristique OpenCV est utilisée (moins précise).

## Installation

```powershell
cd marketing\video-pipeline
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## Configuration

Définissez votre clé Pexels :

```powershell
# PowerShell (session courante)
$env:PEXELS_API_KEY = "votre_cle_ici"

# Ou de façon permanente (utilisateur Windows)
[System.Environment]::SetEnvironmentVariable("PEXELS_API_KEY", "votre_cle_ici", "User")
```

## Lancement

### Pipeline complet

```powershell
python run.py
```

### Reprendre après une erreur

```powershell
# Reprendre à l'étape sélection
python run.py --from select

# Une seule étape
python run.py --only fetch

# Forcer la réexécution
python run.py --force
```

### Étapes individuelles

| Étape | Script | Sortie |
|-------|--------|--------|
| 1 | `fetch_clips.py` | `clips/`, `clips.json` |
| 2 | `select_clips.py` | `selection/`, `selection.json` |
| 3 | `generate_pubs.py` | `pubs/pub_01.mp4` … `pub_20.mp4` |

## Structure

```
video-pipeline/
├── fetch_clips.py      # Téléchargement Pexels
├── select_clips.py     # Scoring OpenCV + top 10
├── generate_pubs.py    # Assemblage MoviePy + texte incrusté
├── run.py              # Orchestration avec reprise
├── config.py           # Paramètres partagés
├── utils.py            # HTTP, logs, JSON
├── scripts.json        # 20 scripts pub Novia (FR-CA)
├── requirements.txt
├── clips/              # Clips bruts (gitignored)
├── selection/          # Top 10 clips
├── pubs/               # Pubs finales
└── logs/               # Journaux d'exécution
```

## Critères de sélection (étape 2)

Chaque clip est noté sur :

| Critère | Poids | Description |
|---------|-------|-------------|
| Stabilité | 30 % | Flux optique faible = caméra stable |
| Netteté | 25 % | Variance du Laplacien |
| Contraste | 20 % | Écart-type des niveaux de gris |
| Luminosité | 15 % | Pénalise trop sombre / surexposé |
| Absence de texte | 10 % | Rejette sous-titres incrustés |

## Format des pubs (étape 3)

- **Résolution** : 1080×1920 (portrait)
- **Durée** : 20 s à 30 fps, H.264
- **Texte** : blanc sur bande noire semi-transparente
- **Timing** :
  - 0–3 s → accroche
  - 3–15 s → corps
  - 15–20 s → appel à l'action

Les scripts sont dans `scripts.json`. Modifiez-les librement avant de regénérer :

```powershell
python run.py --only generate --force
```

## Termes de recherche Pexels

- plumber working
- mechanic garage
- construction worker
- electrician working
- phone ringing
- smartphone notification
- texting phone
- small business owner
- workshop tools
- hands working

5 clips par terme, portrait, 5–20 s, max 1080p.

## Dépannage

| Problème | Solution |
|----------|----------|
| `PEXELS_API_KEY manquante` | Définir la variable d'environnement |
| Rate limit Pexels (429) | Le script attend et réessaie automatiquement |
| MoviePy lent | Normal — ~1–3 min par pub selon la machine |
| Police illisible | Vérifiez que Segoe UI / Arial est présent (Windows) |
| `clips.json` vide | Vérifier la clé API et la connexion réseau |

## Licence clips

Les vidéos Pexels sont soumises à la [licence Pexels](https://www.pexels.com/license/). Créditez les auteurs si vous publiez sur certaines plateformes.

---

**NoviaAI** — Appels manqués → texto → agent IA → soumission ou RDV.  
[https://noviaai.ca](https://noviaai.ca)
