# Feuille de route

Six lots. Le lot 1 est fait ; les suivants sont écrits pour être découpés en
issues sans retravail.

---

## L0 — Squelette et design system — **fait**

- [x] Application Vite + Vue 3 + Pinia + vue-i18n, déployable en statique
- [x] Jetons de couleur et mode sombre repris de Dot Racing (`assets/main.css`, `styles/dark-mode.css`)
- [x] Kit d'interface repris : `ActionButton`, `BasePopin`, `FloatingMenu`, `Spinner`, `Tag`, `StatCircle`, `VolumeGauge`, `CustomSlider`, `CustomCheckbox`, `NavTabs`, `FeedbackMessage`, `InfoTooltip`
- [x] Stores d'interface : `feedbackStore`, `ui/modalsStore`, `ui/bottomPanelStore`
- [x] `vercel.json`, `.nvmrc`

## L1 — Le décor défile — **fait**

- [x] `src/lib/riderScene/` repris de Dot Racing avec sa batterie de tests
- [x] Source vectorielle résolue depuis un TileJSON (`src/config/scene.js`) au lieu d'être lue sur une carte MapLibre
- [x] `useRideScene` : cycle WebGL, caméra de poursuite, assiette, ciel, danseuse
- [x] `rideState` : le compteur, l'abscisse, le bouclage
- [x] Tableau de bord : vitesse, distance, pente, temps
- [x] Pilote clavier provisoire (`↑` / `↓`)

## L2 — De vrais parcours — **en partie**

- [x] Lecteur GPX durci pour les fichiers du monde réel : `lat`/`lon` dans
      n'importe quel ordre (rien ne l'impose, et les exportateurs se partagent
      les deux usages), préfixes d'espace de noms, apostrophes, segments
      multiples, et `<rte>` accepté quand il n'y a pas de `<trk>`
- [x] Import de GPX dans l'application : sélecteur de fichier et
      glisser-déposer, parcours rangés dans le navigateur (`lib/route/library.js`)
- [x] Écran de choix du parcours (`RoutePicker.vue`)
- [ ] **Déposer deux ou trois vrais GPX dans `public/routes/`** et les déclarer
      dans `lib/route/catalog.js`. Non fait : l'environnement de développement
      n'a pas d'accès sortant vers les sites de parcours (bloqué par la
      politique réseau). L'import rend l'attente indolore, mais l'application
      livrée n'a toujours qu'un tracé synthétique
- [ ] Vérifier le lissage d'altitude sur de vrais relevés : la fenêtre de 50 m
      a été réglée sur du bruit simulé, pas sur un GPS de vélo
- [ ] Profil altimétrique : reprendre `ElevationProfileBottomPanel.vue` +
      `useElevationProfile.js` de Dot Racing, garder le rendu Chart.js,
      réécrire la source de données autour du `RoutePath`
- [ ] Marquer la position courante sur le profil

## L3 — La physique

- [ ] Porter `backend/services/engine/physicsSpeedModel.js` (Dot Racing) en ESM client : garder `computeSteadyStateSpeed`, `getBikeParameters`, `getAirDensity` ; jeter tout le hors-route (VTT, gravel, freinage prudent, caps techniques), soit ~400 des 900 lignes
- [ ] Intégrateur temps réel : `a = (F_moteur − F_résist) / m` à chaque image. C'est l'inertie qui fait qu'une séance se *sent* — la vitesse d'équilibre seule donne un rendu mou
- [ ] Tests : équilibre à 200 W sur le plat, en montée à 6 %, roue libre en descente. Le modèle de Dot Racing sert de référence
- [ ] Brancher `getPowerW` de la scène sur la puissance réelle (à zéro, les jambes s'arrêtent net — `RiderModel.advance` le fait déjà)
- [ ] Poids et gabarit du joueur (`CustomSlider` est déjà là)
- [ ] Compléter le tableau de bord : watts, W/kg, cadence

## L4 — Le home-trainer

- [ ] Web Bluetooth, service Cycling Power `0x1818` / caractéristique `0x2A63`. Le champ de flags en tête de trame décale les octets suivants — c'est la seule vraie difficulté
- [ ] Cadence : `0x1816` / `0x2A5B`, ou le champ optionnel de `0x2A63`
- [ ] Étendre `RiderModel.advance` pour accepter une cadence réelle. Aujourd'hui il ne connaît que le « pace » de Dot Racing (1..10) ou une cadence déduite de la vitesse ; avec un capteur, on a mieux
- [ ] Popin d'appairage (`BasePopin`), reconnexion, état déconnecté visible
- [ ] Lissage 3 s de la puissance **affichée**, valeur brute pour la physique
- [ ] Garder le pilote clavier : c'est ce qui permet de développer sans vélo
- [ ] Hors périmètre : FTMS et le pilotage de résistance

## L5 — Multijoueur

- [ ] Trancher l'hébergement du temps réel — voir [`deploiement.md`](deploiement.md) ; recommandation : Supabase
- [ ] Une salle par parcours. Chaque client publie `(pseudo, distance, puissance, cap)` à 4 Hz
- [ ] Client-autoritaire, aucune anti-triche. Acceptable entre gens qui se connaissent, pas pour un classement public — le dire dans l'interface
- [ ] Brancher `riderCrowd.js` sur ce flux : il attend déjà position et cap, et plafonne à huit coureurs, sans ombre ni lumière (le nombre de lumières fait partie de la clé de programme des shaders — un coureur qui entrerait avec ses feux recompilerait tous les matériaux du décor)
- [ ] Interpolation entre deux diffusions : `raceClock.js` est déjà là pour ça, et `riderCrowd` s'en sert déjà
- [ ] Classement live : reprendre `Leaderboard.vue` et `LeaderboardPopin.vue`

## L6 — Finir la boucle

- [ ] Accueil : parcours, pseudo, poids, appairage
- [ ] Fin de séance : distance, temps, puissance moyenne, dénivelé
- [ ] Export `.fit` ou `.gpx` — c'est ce qui fait revenir les gens
- [ ] Comptes et historique (Supabase, si retenu au lot 5)

---

## Dettes assumées

| | |
|---|---|
| Le parcours **livré** est synthétique | il ne suit aucune route. L'import de GPX contourne le problème, mais ne le règle pas : un visiteur qui arrive sans fichier ne voit que lui |
| Pas d'accès sortant vers les sites de parcours | la politique réseau de l'environnement de développement bloque le téléchargement de GPX ; ils doivent être déposés à la main |
| Trois tests de Dot Racing n'ont pas été repris | ils couvraient `routeAnchor`, `motionDiagnostics` et `vectorSourceConfig`, modules qui n'ont pas de raison d'être ici (51 tests là-bas → 42 repris ici) |
| Pas de test bout-en-bout du mouvement | celui de Dot Racing reposait sur l'ancre de tracé ; il faudra en écrire un autre, autour de physique → distance → tracé → assiette |
| CGU des tuiles Carto non vérifiées | à faire avant d'ouvrir au public |
