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

La contrepartie est à dire aux joueurs : **rouler ensemble demande le même
fichier**. C'est écrit sur l'écran d'accueil.

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
  peloton, classement — sont couverts par des tests ; la liaison elle-même, le
  rendu du peloton et le comportement à la reconnexion demandent deux
  navigateurs et deux personnes.
- Le peloton n'a pas d'avatars ni de chevrons de bord : les coureurs hors de la
  bulle (au-delà de 900 m) ne sont indiqués nulle part, sinon au classement.
- Pas de salon d'attente ni de départ groupé : on entre et on roule. Un
  classement au scratch sur un parcours qu'on n'a pas commencé ensemble n'a
  qu'une valeur indicative.
- Pas de reprise après fermeture de l'onglet : le pseudo est retenu, la
  distance non.
