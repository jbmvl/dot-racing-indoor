# dot-racing-indoor

Une séance de home-trainer dans un paysage réel : le décor est généré par
[worldpaint](https://github.com/jbmvl/worldpaint) à partir du relief et des
données OpenStreetMap du lieu où passe le parcours, et l'interface reprend
celle de [Dot Racing](https://github.com/jbmvl/1230-bornes).

**État : lots 1 à 5, à quelques réserves près.** On importe un GPX, on pédale —
au clavier ou sur un home-trainer connecté en Bluetooth —, la pente et la masse
décident de la vitesse, la pente pilote la résistance de la machine, et le
profil altimétrique montre où l'on en est. Avec un serveur de salles configuré,
les autres coureurs du même parcours apparaissent sur la route et au classement.

Deux réserves, et elles comptent : **rien n'a été essayé avec du matériel**
(aucun capteur, aucun home-trainer piloté) ni **à plusieurs**, et aucun parcours
n'est livré avec l'application. Voir [`docs/backlog.md`](docs/backlog.md).

## Démarrer

```bash
npm install
npm run dev     # http://localhost:5174
npm test        # tests unitaires, sans navigateur
npm run build
```

Commandes : `↑` / `↓` règlent la puissance, en watts. Un home-trainer connecté
prend la main dès qu'il parle ; sans lui, le clavier suffit — c'est ce qui
permet de tout tester sans vélo.

Dans l'autre sens, la **pente part vers la machine** : le service FTMS est
piloté en mode simulation, on lui décrit le monde (pente, vent, roulement,
pénétration dans l'air) et elle calcule la force à opposer. Une machine qui ne
sait pas simuler le dit sur l'écran d'appairage, et la séance continue sans.

Le Bluetooth demande Chrome ou Edge, sur ordinateur ou Android, en HTTPS ou sur
`localhost`. **iOS ne le permet pas**, quel que soit le navigateur.

## Ce qui vient d'où

| | |
|---|---|
| Le décor 3D | `worldpaint`, dépendance Git — **jamais** un chemin relatif. `npm run build` l'amène au dernier `main` ; `WORLDPAINT_REF` fige |
| Le coureur, son assiette, la foule | `src/lib/riderScene/`, repris de Dot Racing |
| Le design (jetons, kit d'interface) | `src/assets/main.css`, `src/components/ui/`, repris de Dot Racing |
| Le parcours, la séance, la scène | écrits ici |
| Le home-trainer et les salles | écrits ici : `src/lib/trainer/`, `src/lib/race/`, `multiplayer/` |

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

Aucun parcours n'est livré avec l'application pour l'instant : tout passe par
l'import. Y remettre de vrais tracés demande de régler la question des droits —
une trace publiée par un club ou un site de parcours ne se redistribue pas dans
un dépôt public par défaut.

## Rouler à plusieurs

Optionnel, et éteint par défaut. Avec `VITE_RACE_SERVER` pointant sur un
serveur de salles, chaque client publie sa position quatre fois par seconde et
voit les autres sur la route et au classement.

Il n'y a pas de code d'invitation : **une salle est un parcours**. Elle est
l'empreinte géométrique du tracé, donc deux personnes qui importent le même GPX
s'y retrouvent sans s'être rien dit — et rouler ensemble demande le même
fichier.

C'est **client-autoritaire** : chacun annonce sa propre position, personne ne
vérifie. Acceptable entre gens qui se connaissent, pas pour un classement
public — et l'écran d'accueil le dit.

Le serveur est un Worker Cloudflare, dans `multiplayer/`, sans aucune
dépendance npm. Voir [`docs/multijoueur.md`](docs/multijoueur.md).

## Déploiement

Application statique, sans serveur : `npm run build` produit `dist/`, que
Vercel (ou n'importe quel hébergeur statique) sert tel quel. Voir
[`docs/deploiement.md`](docs/deploiement.md) — en particulier la contrainte
qui décidera du multijoueur.

## Données

- **Relief** : tuiles Terrarium (AWS Open Data), sans clé.
- **Vectoriel** : TileJSON au schéma OpenMapTiles, résolu à l'exécution.
  Par défaut Carto ; surchargeable par `VITE_VECTOR_TILEJSON`.
