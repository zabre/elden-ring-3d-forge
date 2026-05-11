# Comment ajouter un modèle GLB via Google Drive

## Étape 1 — Uploader le GLB sur Drive

1. Va sur [drive.google.com](https://drive.google.com)
2. Uploade ton fichier `.glb`
3. Clic droit sur le fichier → **Partager** → "Tout le monde avec le lien" (Lecteur)
4. Copie le lien. Il ressemble à :
   ```
   https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view?usp=sharing
   ```

## Étape 2 — Transformer en URL directe

Prends l'**ID** du fichier (la longue chaîne entre `/d/` et `/view`) et construis cette URL :

```
https://drive.google.com/uc?export=download&id=TON_ID_ICI
```

Exemple :
```
https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOpQrStUvWxYz
```

⚠️ Pour les fichiers **> 25 MB**, Google affiche une page de confirmation antivirus.
Dans ce cas, utilise ce format à la place (contourne la confirmation) :
```
https://drive.google.com/uc?export=download&confirm=t&id=TON_ID_ICI
```

## Étape 3 — Coller dans library.json

Ouvre `public/library.json` dans GitHub et remplis le champ `remoteUrl` :

```json
{
  "id": "malenia",
  "name": "Malenia, Blade of Miquella",
  "modelPath": "",
  "remoteUrl": "https://drive.google.com/uc?export=download&confirm=t&id=1AbCdEfGhIjKlMnOpQrStUvWxYz",
  "info": { ... }
}
```

Laisse `modelPath` vide quand tu utilises `remoteUrl`.

## Étape 4 — Commit et déploiement

Commite sur `main` → GitHub Actions rebuilde → le modèle apparaît sur Pages.

---

## Problème CORS éventuel

Si le modèle ne se charge pas (erreur CORS dans la console), Google Drive bloque la requête cross-origin.
Dans ce cas, passe sur **Cloudflare R2** (gratuit 10 GB) ou **Backblaze B2** qui servent les fichiers
avec les bons headers CORS. Voir les instructions dans le chat.
