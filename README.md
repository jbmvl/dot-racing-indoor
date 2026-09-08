# dot-racing-indoor

Une séance de home-trainer dans un paysage réel : le décor est généré par
[worldpaint](https://github.com/jbmvl/worldpaint) à partir du relief et des
données OpenStreetMap du lieu où passe le parcours, et l'interface reprend
celle de [Dot Racing](https://github.com/jbmvl/1230-bornes).

**État : lot 1 sur 6.** Le décor défile le long d'un parcours, à une vitesse
réglée au clavier. Il n'y a encore ni modèle physique, ni home-trainer, ni
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

Un parcours est un fichier GPX servi en statique depuis `public/routes/`, plus
une ligne dans `src/lib/route/catalog.js`.

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
