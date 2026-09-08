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
- [x] Profil altimétrique : traitement visuel repris de Dot Racing (axes muets,
      courbe remplie jusqu'aux bords, chiffres en Fugaz One), source de données
      réécrite autour du `RoutePath` — 2 632 lignes là-bas, dont l'essentiel
      tenait aux avatars, à la trace passée/future et au survol synchronisé avec
      la carte
- [x] Position courante sur le profil, et voile sur la portion parcourue
- [ ] Le profil n'est pas interactif (ni survol, ni clic). Volontaire pour
      l'instant : il informe, il ne pilote rien

## L3 — La physique — **fait**

- [x] Modèle physique écrit ici plutôt que porté de Dot Racing. Là-bas, la
      vitesse d'équilibre est résolue à chaque tick de cinq secondes ; ici on
      rend soixante images par seconde et le joueur pédale en direct. Poser
      l'équilibre à chaque image donnerait un vélo sans masse
- [x] Intégrateur de forces : `a = (F_pédale − F_aéro − F_roulement − F_gravité) / m`
- [x] Vitesse d'équilibre conservée comme **référence de test** : l'intégrateur
      doit y converger, ce qui prouve qu'il intègre les bonnes forces et pas
      seulement des forces plausibles
- [x] Densité de l'air selon l'altitude
- [x] Le clavier pilote des **watts**, comme le fera le capteur
- [x] Tableau de bord : watts, km/h, W/kg, pente, distance, temps
- [ ] Réglage du gabarit dans l'interface (`setup` et `configure` existent dans
      `useRide`, aucun écran ne les expose encore — la masse est donc figée à
      75 + 8 kg)
- [ ] Vent : `resistanceForces` le prend, rien ne le fournit

## L4 — Le home-trainer — **en partie**

- [x] Décodage du service standard Cycling Power (`0x1818` / `0x2A63`), avec
      les décalages calculés drapeau par drapeau — un décalage codé en dur
      marche sur son propre capteur et échoue chez le voisin
- [x] Cadence déduite des compteurs de manivelle, repli des compteurs 16 bits
      traité (l'horodatage fait le tour toutes les 64 secondes : c'est un
      événement fréquent, pas un cas limite)
- [x] Puissance brute pour la physique, moyennée sur 3 s pour l'affichage
- [x] Appairage depuis l'écran d'accueil, reprise du clavier si le capteur se
      tait
- [x] Le clavier reste, et restera : c'est ce qui permet de développer sans vélo
- [ ] **Rien n'a été essayé avec un vrai capteur.** Le décodage est testé sur
      des trames construites à la main ; la liaison Bluetooth elle-même ne peut
      pas l'être sans matériel
- [ ] Reconnexion automatique après une coupure (aujourd'hui : retour à l'état
      « non connecté », il faut réappairer)
- [ ] Étendre `RiderModel.advance` pour accepter une cadence réelle. Il ne
      connaît que le « pace » de Dot Racing (1..10) ou une cadence déduite de la
      vitesse ; avec un capteur, on a mieux
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
| Aucun parcours livré | le cercle synthétique a été retiré ; un visiteur qui arrive sans fichier ne voit qu'un écran d'import. Remettre de vrais tracés demande de régler la question des droits |
| Pas d'accès sortant vers les sites de parcours | la politique réseau de l'environnement de développement bloque le téléchargement de GPX ; ils doivent être déposés à la main |
| Le mode sombre est du code mort | `styles/dark-mode.css` a été repris, mais pas le `useDarkMode` qui pose `data-theme` sur `<html>`. Les composants sont prêts, rien ne bascule. Le profil altimétrique, lui, suit aussi `prefers-color-scheme`, donc il sera juste dans les deux cas |
| Trois tests de Dot Racing n'ont pas été repris | ils couvraient `routeAnchor`, `motionDiagnostics` et `vectorSourceConfig`, modules qui n'ont pas de raison d'être ici (51 tests là-bas → 42 repris ici) |
| Pas de test bout-en-bout du mouvement | celui de Dot Racing reposait sur l'ancre de tracé ; il faudra en écrire un autre, autour de physique → distance → tracé → assiette |
| CGU des tuiles Carto non vérifiées | à faire avant d'ouvrir au public |
