# Kit publicités NoviaAI — vidéos Pexels + scripts

## Contenu

| Fichier | Description |
|---------|-------------|
| `videos-curated.json` | 15 vidéos Pexels sélectionnées (liens + scénario) |
| `scripts-publicites.md` | 4 pubs complètes (15 s / 30 s) + textes Meta/Google |
| `preview-pubs.html` | Aperçu dans le navigateur — ouvrez ce fichier |
| `videos/download/` | Vidéos MP4 après téléchargement (voir ci-dessous) |

## Télécharger les vidéos sur votre PC

1. Créez une clé **gratuite** : [pexels.com/api](https://www.pexels.com/api/)
2. Dans `noviaai-site/.env`, ajoutez :
   ```
   PEXELS_API_KEY=votre_cle_ici
   ```
3. Double-cliquez **`TELECHARGER-VIDEOS-PEXELS.bat`**  
   *(ou `node scripts/fetch-pexels-videos.cjs`)*

Les MP4 arrivent dans `marketing/pubs-noviaai/videos/download/`.

## Monter la pub (CapCut, Canva, Premiere)

1. Ouvrez **`preview-pubs.html`** pour voir le storyboard
2. Suivez **`scripts-publicites.md`** pour voix off et textes
3. Importez les MP4 dans CapCut (gratuit) ou Canva Video
4. Ajoutez sous-titres (obligatoire — 85 % sans son)
5. CTA final : **noviaai.ca — Essai 14 jours**

## Crédit Pexels

Gratuit pour usage commercial. Crédit apprécié : « Vidéos : Pexels.com »

## 4 concepts prêts

- **Pub A** — Trop occupé pour répondre (30 s)
- **Pub B** — Le garage / mécanicien (15 s vertical)
- **Pub C** — Bureau débordé (30 s)
- **Pub D** — Avant / Après (20 s)
