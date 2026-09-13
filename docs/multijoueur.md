# Le multijoueur, et ce qu'il a coûté

## Ce qui a été tranché

La feuille de route laissait trois sorties ouvertes pour l'hébergement du
temps réel — Supabase, Cloudflare Durable Objects, un VPS avec `ws` — et
recommandait Supabase, parce qu'il réglait du même coup les comptes et
l'historique des séances du lot 6.

C'est **Durable Objects** qui a été retenu, pour une raison qui a pesé plus
lourd que l'économie d'un futur chantier : le client n'a alors **aucune
dépendance**. Une salle se rejoint avec le `WebSocket` du navigateur et des
trames JSON de cent octets ; il n'y a pas de SDK à charger sur une page qui
porte déjà sept cents kilo-octets de moteur 3D, pas de client à tenir à jour,
et le transport tient derrière `useRoom` — quatre-vingts lignes qu'on remplace
sans toucher au reste.

Le reste suit la forme du problème : une salle est un état partagé par quelques
connexions, qui doit vivre tant qu'elles roulent et disparaître ensuite. C'est
la définition d'un Durable Object, et son nom d'instance est l'empreinte du
parcours.

Supabase n'est pas écarté pour autant : les comptes et l'historique du lot 6 ne
demandent rien de temps réel, et peuvent parfaitement s'installer à côté.

## Une salle est un parcours

Il n'y a pas de code d'invitation à s'échanger. La salle est l'**empreinte
géométrique du tracé** (`routeFingerprint`) : deux personnes qui importent le
même fichier GPX tombent dans la même salle sans s'être rien dit, et deux
parcours différents ne se croisent jamais.

L'empreinte se tire de la géométrie — seize positions arrondies au mètre, plus
la longueur — et jamais du nom du fichier ni de l'identifiant local, qui sont
propres à chaque navigateur. Un même tracé réexporté avec un pas
d'échantillonnage différent reste la même salle.

La contrepartie était à dire aux joueurs : rouler ensemble demandait le même
fichier. C'est ce que le salon a levé.

## Le salon, ou comment une salle devient visible

L'empreinte est élégante et **muette** : tant qu'on n'a pas le fichier de
l'autre, on ne peut ni savoir qu'il roule, ni le rejoindre. Deux onglets
ouverts sur deux parcours différents ne se voient pas, et rien à l'écran ne dit
pourquoi — c'est la première chose que le multijoueur a coûté en
incompréhension.

Le salon (`multiplayer/lobby.js`) est un second objet durable, en instance
unique, qui répond à cette question. Qui importe un GPX se voit proposer
d'**ouvrir une salle** ; celle-ci apparaît alors sur l'écran d'accueil des
autres — « Salle de Jean · Ventoux · 21,3 km » —, et la rejoindre télécharge le
tracé avant de rouler. Plus de fichier à s'échanger.

### Ce que ça coûte, et qu'il faut dire en face

Le tracé monte sur le serveur et **tout occupant du salon peut le
télécharger**. Un GPX de sortie part souvent du domicile de celui qui l'a
enregistré : l'interface le signale au moment d'ouvrir, et ouvrir reste un
choix explicite — l'import seul n'annonce rien.

### L'hôte maintient sa salle en vie

Rien n'est écrit sur disque, contrairement à ce qu'on attendrait d'un annuaire.
L'hôte se réannonce toutes les trente secondes et une entrée qu'on cesse de
rafraîchir s'efface au bout de quatre-vingt-dix : c'est ce qui fait disparaître
la salle de qui a fermé son onglet, cas autrement plus fréquent qu'une instance
recyclée par la plateforme — laquelle se reconstruit alors toute seule à
l'annonce suivante, sans qu'aucun état périmé ne survive.

Le tracé, lui, ne part qu'à l'ouverture ; les réannonces ne portent que les
métadonnées. Si le salon a été reconstruit entre-temps et ne le connaît plus,
il répond `needsRoute` et l'hôte le renvoie — sans quoi chaque hôte
téléverserait son GPX deux fois par minute pour rien.

### Le piège : quelles coordonnées transmettre

Celui qui importe un GPX **ne roule pas sur les coordonnées du fichier**. Il
roule sur celles que son dépôt a retenues, arrondies au millionième de degré
(`useRouteLibrary.resolve`). Or l'empreinte se tire de la géométrie au mètre
près : transmettre les coordonnées d'origine ferait tomber l'invité sur une
empreinte voisine mais différente — mesuré sur quatre cents tracés de test,
**plus d'un sur deux** —, c'est-à-dire deux salles vides au lieu d'une salle à
deux, sans le moindre message d'erreur pour le dire.

Le salon transporte donc exactement ce que le dépôt garde, dans la forme que
`library.packPoints` produit. Ce n'est pas un troisième format qui s'ajouterait
aux deux qui ont déjà coûté une panne d'import (cf. `CLAUDE.md`) : c'est la
sérialisation du **brut**, et elle ne sort jamais de `lib/race/lobby.js`.
`src/lib/race/lobby.test.mjs` franchit toute la couture — points bruts, dépôt,
annonce, JSON, réception, dépôt de l'invité, tracé roulable, empreinte.

### Pourquoi le salon n'est pas dans la salle

Une salle ignore qu'elle est listée, et n'a personne à prévenir. Les deux
objets ne se connaissent pas : le flux de positions ne doit rien devoir à un
annuaire, qui peut disparaître et se reconstruire sans qu'un seul coureur s'en
aperçoive. Et le salon vit à un seul endroit du globe — sans importance pour
une liste relue toutes les cinq secondes, rédhibitoire pour des positions.

## Client-autoritaire, et personne ne surveille

Chaque client annonce sa propre position ; le serveur la recopie sans la
relire. Il n'y a pas d'anti-triche, et il ne peut pas y en avoir : la distance
appartient au client, c'est la règle qui structure tout le jeu.

Annoncer 90 km/h suffirait donc à gagner. C'est acceptable entre gens qui se
connaissent — et l'interface le dit, sur l'écran d'accueil — mais cela
interdit tout classement public. Un classement qu'on veut défendre demanderait
que le serveur simule, c'est-à-dire un autre jeu.

## Ce qui circule

Quatre fois par seconde, une trame d'une centaine d'octets :

```json
{ "t": "at", "d": 12345.6, "r": 2345.6, "w": 244, "v": 8.33, "l": 1 }
```

| | |
|---|---|
| `d` | le compteur — tout ce qui a été parcouru. **C'est lui qui classe** |
| `r` | l'abscisse sur le tracé, toujours dans ses bornes. **C'est elle qui place** |
| `w` | watts |
| `v` | vitesse au sol, en m/s |
| `l` | tours bouclés |

Les confondre mettrait le coureur du deuxième tour trois kilomètres après
l'arrivée.

**Ni coordonnées ni cap.** La feuille de route prévoyait de publier le cap ;
il n'y est pas, et c'est délibéré : une salle est un parcours, donc tout le
monde a déjà le tracé en mémoire. Une abscisse suffit à retrouver la position,
le cap et la pente de n'importe qui par `RoutePath.positionAt`. Envoyer des
coordonnées coûterait plus d'octets pour un résultat pire — arrondies puis
interpolées en droit, elles posent les autres coureurs à côté de la chaussée
dans les virages, là où l'abscisse les y garde toujours.

Le serveur ajoute l'identifiant et le pseudo à chaque trame qu'il recopie ;
c'est tout ce qu'il apporte. Il garde en mémoire le dernier état de chacun pour
une seule raison : celui qui arrive voit un peloton en place au lieu d'une
route vide le temps d'une diffusion.

## Entre deux diffusions

Un quart de seconde d'écart, c'est deux mètres à 30 km/h : sans interpolation,
le peloton avancerait par bonds. C'est `raceClock` qui s'en charge, une horloge
par coureur, à l'intérieur de `riderCrowd` — les deux viennent de Dot Racing et
faisaient déjà exactement ce travail.

Ses réglages par défaut, en revanche, visent un moteur qui diffuse **toutes les
cinq secondes** : ils imposent quatre secondes de retard de lecture. Appliqués
ici, le voisin de roue serait affiché trente mètres derrière sa vraie position.
La scène passe donc son propre jeu de constantes (`CROWD_CLOCK` dans
`useRideScene.js`), taillé pour un flux à 4 Hz : un tiers de seconde de retard,
et une prolongation de quelques secondes quand un coureur se tait.

## Mettre en service

Le serveur est un Worker Cloudflare, dans `multiplayer/`. Il n'a **aucune
dépendance npm** : `wrangler` s'invoque par `npx`.

```bash
cd multiplayer
npx wrangler@latest deploy        # rend une adresse en <nom>.<compte>.workers.dev
```

Puis, côté site, une variable d'environnement — et c'est la seule :

```
VITE_RACE_SERVER=wss://dot-racing-rooms.<compte>.workers.dev
```

Sans elle, l'application est exactement ce qu'elle était : une séance solo,
sans connexion sortante, sans panneau de classement. C'est délibéré — le
multijoueur est la première fonction du projet qui coûte de l'infrastructure,
et rien d'autre ne doit en dépendre.

En local, les deux côtés tournent ensemble :

```bash
cd multiplayer && npx wrangler@latest dev    # écoute sur 127.0.0.1:8787
VITE_RACE_SERVER=ws://127.0.0.1:8787 npm run dev
```

## Ce qui reste à faire

- **Rien n'a été essayé à plusieurs.** Les modules purs — trame, empreinte,
  peloton, classement, salon — sont couverts par des tests ; la liaison
  elle-même, le rendu du peloton et le comportement à la reconnexion demandent
  deux navigateurs et deux personnes.
- Le peloton n'a pas d'avatars ni de chevrons de bord : les coureurs hors de la
  bulle (au-delà de 900 m) ne sont indiqués nulle part, sinon au classement.
- Pas de départ groupé : on entre et on roule. Un classement au scratch sur un
  parcours qu'on n'a pas commencé ensemble n'a qu'une valeur indicative.
- Le salon ne dit pas **combien** de coureurs sont dans une salle : l'annonce
  vient de l'hôte, qui ne les a pas forcément encore vus. Une salle ouverte
  peut donc être vide.
- Rien n'a été essayé à deux navigateurs sur le salon non plus : la liste,
  l'ouverture, la récupération du tracé et l'empreinte qui doit tomber juste
  demandent deux personnes.
- Pas de reprise après fermeture de l'onglet : le pseudo est retenu, la
  distance non.
