# Déploiement, et ce qu'il impose au reste

## La forme retenue : une application statique

Le client est une application Vite + Vue 3. `npm run build` produit un dossier
`dist/` de fichiers statiques ; `vercel.json` dit à Vercel de le servir et de
renvoyer toutes les routes vers `index.html`. Il n'y a rien d'autre à
configurer : brancher le dépôt suffit, et chaque poussée redéploie.

Le même `dist/` se sert à l'identique chez Cloudflare Pages, Netlify ou un
Nginx. Rien dans le code ne connaît Vercel.

**Pourquoi pas Nuxt.** Le rendu serveur n'apporte rien à un jeu WebGL : la
page utile est un canevas, il n'y a pas de contenu à indexer, et tout le code
de la scène touche `window`, `document` et le contexte graphique. Nuxt aurait
en revanche imposé sa convention de dossiers, alors que l'objectif explicite
est de reprendre les composants de Dot Racing — lui aussi Vite + Vue — sans les
retoucher.

## Mettre en ligne, concrètement

### 1. La branche de production

Vercel déploie la **branche de production**, `main` par défaut — et `main` ne
contient aujourd'hui qu'un README. Importer le dépôt tel quel déploierait donc
une page vide. Deux options :

- fusionner `claude/indoor-mvp` dans `main` (le plus simple, et c'est la
  destination naturelle) ;
- ou, dans *Settings → Git → Production Branch*, désigner
  `claude/indoor-mvp`.

Les autres branches produiront de toute façon des déploiements de
prévisualisation, avec une URL par poussée.

### 2. L'import

Sur vercel.com : *Add New → Project*, choisir le dépôt, laisser tous les
réglages par défaut. `vercel.json` dit déjà tout ce qu'il faut (préréglage
Vite, `dist/`, renvoi des routes vers `index.html`). Aucune variable
d'environnement n'est nécessaire pour démarrer.

En ligne de commande, si on préfère :

```bash
npx vercel@latest link      # rattache le dossier au projet
npx vercel@latest --prod    # déploie
```

### 3. Le piège qui aurait fait échouer la build

`worldpaint` est une dépendance Git. Écrite en raccourci
(`github:jbmvl/worldpaint#main`), npm la réécrit dans le lockfile en
`git+ssh://git@github.com/…` — et `npm ci` échoue alors sur Vercel, faute de
clé SSH sur la machine de build. Le symptôme est un `Permission denied
(publickey)` en plein `npm ci`, qui n'a rien à voir avec le code.

La dépendance est donc déclarée comme une **archive HTTPS figée sur un
commit** :

```json
"worldpaint": "https://github.com/jbmvl/worldpaint/archive/<sha>.tar.gz"
```

Trois bénéfices d'un coup : plus de git ni de SSH sur la machine de build, une
empreinte d'intégrité dans le lockfile, et une version figée — deux builds à
six mois d'écart installent le même décor. Le prix à payer est qu'une
correction dans `worldpaint` ne descend plus toute seule : il faut remplacer le
SHA et relancer `npm install`. C'est la contrepartie voulue.

## La contrainte qui décidera du multijoueur

Une fonction serverless (Vercel, Netlify) **ne peut pas tenir une connexion
ouverte**. Elle répond à une requête et meurt. Le serveur WebSocket qu'un jeu
temps réel demande — une salle, des positions qui circulent plusieurs fois par
seconde — n'a donc pas sa place à côté du site.

Trois sorties, à trancher au lot 5 :

| | Ce que ça donne | Ce que ça coûte |
|---|---|---|
| **Supabase** (Realtime + Postgres + Auth) | diffusion et présence sur WebSocket, plus les comptes et l'historique des séances dans la foulée | une dépendance de plus, et un modèle de données à tenir |
| **Cloudflare Durable Objects** | une salle = un objet, exactement la forme du problème ; très bon marché | un second environnement de déploiement à côté du site |
| **Un VPS avec `ws`** | contrôle total, rien à apprendre | à exploiter et à surveiller soi-même — précisément ce qu'on cherchait à éviter |

Recommandation : **Supabase**, parce qu'il règle en même temps les comptes et
la sauvegarde des séances, qui arrivent de toute façon au lot 6.

Rien de tout cela n'est engagé aujourd'hui : les lots 1 à 4 ne demandent aucun
serveur, et c'est délibéré. Le multijoueur est la première fonction qui coûte
de l'infrastructure ; autant que tout le reste tourne avant de la payer.

## Variables d'environnement

Préfixe `VITE_` obligatoire pour tout ce que le client lit.

| | |
|---|---|
| `VITE_VECTOR_TILEJSON` | TileJSON de la source vectorielle (schéma OpenMapTiles). Par défaut, Carto. |

## Le point à surveiller

Le fournisseur de tuiles par défaut est Carto. Ses conditions d'utilisation
n'ont pas été vérifiées pour un jeu ouvert au public — c'est à faire avant
d'ouvrir les portes. Le repli est un serveur de tuiles à soi (Planetiler sur un
extrait régional) ; seule la variable ci-dessus change.
