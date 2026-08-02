# Brancher Meta pour publication auto (NoviaAI)

## 1. Prérequis (déjà en cours)
- [ ] Meta Business Manager
- [ ] Page Facebook NoviaAI
- [ ] Instagram **professionnel** lié à la Page
- [ ] Pixel (fait : `2225416118303851`)

## 2. Créer l’app développeur
1. Va sur https://developers.facebook.com/apps/
2. **Créer une application** → type **Business**
3. Nom : `NoviaAI Publisher`
4. Associe ton Business Manager

## 3. Ajouter les produits
Dans l’app :
- **Facebook Login for Business** (ou Facebook Login)
- **Instagram** / Instagram Graph API (si proposé)

## 4. Permissions à demander (Graph API Explorer)
Ouvre https://developers.facebook.com/tools/explorer/

1. Sélectionne ton app `NoviaAI Publisher`
2. **Generate Access Token** (User Token) avec :
   - `pages_show_list`
   - `pages_read_engagement`
   - `pages_manage_posts`
   - `pages_manage_engagement`
   - `instagram_basic`
   - `instagram_content_publish`
   - `business_management`
3. Autorise la Page NoviaAI

## 5. Récupérer les IDs
Toujours dans Graph API Explorer, ou via curl :

```
GET /me/accounts
```

Tu obtiens pour chaque page : `id` (Page ID) + `access_token` (Page token court).

Puis :

```
GET /{page-id}?fields=instagram_business_account
```

Note le `instagram_business_account.id`.

## 6. Token longue durée
1. https://developers.facebook.com/tools/debug/accesstoken/
2. Colle le **Page access token**
3. Ou échange User token → long-lived, puis `GET /me/accounts` pour un Page token long-lived

Le Page token long-lived ne expire souvent **pas** tant que le mot de passe / permissions ne changent pas.

## 7. Fichier secrets (ne pas committer)
Créer / compléter `noviaai-site/secrets/meta.env` :

```
META_PIXEL_ID=2225416118303851
META_PAGE_ID=...
META_IG_USER_ID=...
META_PAGE_ACCESS_TOKEN=...
```

## 8. Me renvoyer (dans le chat)
1. `META_PAGE_ID`
2. `META_IG_USER_ID`
3. `META_PAGE_ACCESS_TOKEN` (je l’enregistre dans secrets, tu pourras le régénérer après)

Ensuite je publie `marketing/explainer/output/noviaai-comment-ca-marche.mp4` en Reel / post.
