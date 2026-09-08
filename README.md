# dot-racing-indoor

Une séance de home-trainer dans un paysage réel : le décor est généré par
[worldpaint](https://github.com/jbmvl/worldpaint) à partir du relief et des
données OpenStreetMap du lieu où passe le parcours, et l'interface reprend
celle de [Dot Racing](https://github.com/jbmvl/1230-bornes).

**État : lot 2 sur 6, en partie.** Le décor défile le long d'un parcours, à une
vitesse réglée au clavier, et n'importe quel GPX peut être déposé dans
l'application. Il n'y a encore ni modèle physique, ni home-trainer, ni
multijoueur — voir [`docs/backlog.md`](docs/backlog.md).

## Démarrer

```bash
npm install
npm run dev     # http://localhost:5174
npm test        # tests unitaires, sans navigateur
npm run build
```

Commandes : `↑` / `↓` règlent la vitesse.

## Ce qui vient d'où

| | |
|---|---|
| Le décor 3D | `worldpaint`, dépendance Git — **jamais** un chemin relatif |
| Le coureur, son assiette, la foule | `src/lib/riderScene/`, repris de Dot Racing |
| Le design (jetons, kit d'interface) | `src/assets/main.css`, `src/components/ui/`, repris de Dot Racing |
| Le parcours, la séance, la scène | écrits ici |

La dépendance va du jeu vers le décor, jamais l'inverse : `worldpaint`
n'importe rien d'ici, et three.js lui est injecté.

## Parcours

Deux origines, une seule liste :

- **livré** — un fichier GPX dans `public/routes/`, plus une ligne dans
  `src/lib/route/catalog.js` ;
- **déposé** — n'importe quel `.gpx` glissé sur l'écran d'accueil, rangé dans
  le navigateur. C'est ce qui permet de rouler sur son propre parcours sans
  passer par un commit.

Le lecteur encaisse les formes qu'on rencontre vraiment : `lat`/`lon` dans
n'importe quel ordre, préfixes d'espace de noms, segments multiples, et un
`<rte>` quand le fichier n'a pas de `<trk>`.

Celui livré (`boucle-demo.gpx`) est **synthétique** : un cercle avec une
altitude inventée, fabriqué par `node scripts/make-demo-loop.mjs`. Il ne suit
aucune route — le coureur traverse des champs. Il n'existe que pour donner
quelque chose à faire défiler en attendant de vrais tracés (lot 2).

## Déploiement

Application statique, sans serveur : `npm run build` produit `dist/`, que
Vercel (ou n'importe quel hébergeur statique) sert tel quel. Voir
[`docs/deploiement.md`](docs/deploiement.md) — en particulier la contrainte
qui décidera du multijoueur.

## Données

- **Relief** : tuiles Terrarium (AWS Open Data), sans clé.
- **Vectoriel** : TileJSON au schéma OpenMapTiles, résolu à l'exécution.
  Par défaut Carto ; surchargeable par `VITE_VECTOR_TILEJSON`.
