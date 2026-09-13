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

Deux bénéfices d'un coup : plus de git ni de SSH sur la machine de build, et
une empreinte d'intégrité dans le lockfile.

Le prix à payer était qu'une correction dans `worldpaint` ne descendait plus
toute seule : il fallait remplacer le SHA à la main. C'est désormais le travail
de `scripts/worldpaint.mjs`, que `npm run build` appelle en premier : il résout
le `main` de `worldpaint` par `git ls-remote`, réécrit l'URL et relance
`npm install`, de sorte que le lockfile porte toujours une empreinte exacte.

Ce qui aurait été plus simple et ne marche pas : pointer la dépendance sur
`…/archive/refs/heads/main.tar.gz`. L'empreinte inscrite dans le lockfile décrit
le contenu téléchargé ; le premier commit suivant la rend fausse, et
l'installation s'arrête sur un `EINTEGRITY`. Une URL mouvante et un lockfile ne
peuvent pas coexister — d'où le choix de garder l'URL figée et de déplacer le
SHA.

Trois conséquences à connaître :

- le build a besoin de joindre GitHub. S'il n'y arrive pas, il **ne tombe pas** :
  le SHA déjà figé sert, avec un avertissement dans le journal ;
- le décor n'est plus reproductible dans le temps. Deux builds à six mois
  d'écart ne donnent plus le même paysage ;
- `WORLDPAINT_REF=<sha>` refait un build passé à l'identique ;
  `WORLDPAINT_REF=<branche>` essaie un décor en cours.

Le SHA reste écrit dans `package.json` : en local, une mise à jour se voit dans
`git diff` et se commite comme avant.

## La contrainte qui a décidé du multijoueur — tranchée

Une fonction serverless (Vercel, Netlify) **ne peut pas tenir une connexion
ouverte**. Elle répond à une requête et meurt. Le serveur qu'un jeu temps réel
demande — une salle, des positions qui circulent plusieurs fois par seconde —
n'a donc pas sa place à côté du site.

Trois sorties étaient ouvertes ; c'est **Cloudflare Durable Objects** qui a été
retenu, et non Supabase comme le supposait la recommandation d'alors. La raison
a pesé plus lourd que l'économie d'un futur chantier : le client n'a ainsi
**aucune dépendance** — une salle se rejoint avec le `WebSocket` du navigateur
et des trames JSON de cent octets, sur une page qui porte déjà sept cents
kilo-octets de moteur 3D. Le transport tient derrière `useRoom`, et se remplace
sans toucher au reste.

Le serveur vit dans `multiplayer/`, se déploie par `npx wrangler deploy`, et
n'a aucune dépendance npm. Les comptes et l'historique du lot 6 ne demandent
rien de temps réel : Supabase peut parfaitement s'installer à côté le jour où
ils arriveront. Tous les détails — protocole, salles, ce qui reste à vérifier —
sont dans [`multijoueur.md`](multijoueur.md).

Le site, lui, reste une application statique : **sans `VITE_RACE_SERVER`, rien
ne change**, pas une connexion sortante de plus, et la séance est solo.

## Variables d'environnement

Préfixe `VITE_` obligatoire pour tout ce que le client lit.

| | |
|---|---|
| `VITE_VECTOR_TILEJSON` | TileJSON de la source vectorielle (schéma OpenMapTiles). Par défaut, Carto. |
| `VITE_RACE_SERVER` | Serveur de salles (`wss://…`), cf. [`multijoueur.md`](multijoueur.md). Absente, le multijoueur est simplement éteint. |

## Le point à surveiller

Le fournisseur de tuiles par défaut est Carto. Ses conditions d'utilisation
n'ont pas été vérifiées pour un jeu ouvert au public — c'est à faire avant
d'ouvrir les portes. Le repli est un serveur de tuiles à soi (Planetiler sur un
extrait régional) ; seule la variable ci-dessus change.
