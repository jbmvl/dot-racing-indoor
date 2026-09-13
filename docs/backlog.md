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
      politique réseau). L'import rend l'attente indolore, mais un visiteur qui
      arrive sans fichier ne voit qu'un écran d'import
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
- [x] Repli sur Indoor Bike Data (`0x2AD2`) quand la machine ne publie pas
      Cycling Power : certains home-trainers récents ne parlent que FTMS, et
      n'interroger qu'un service les rendait muets alors que l'appairage réussit
- [x] **Pilotage de la résistance par la pente** (`0x2AD9`, mode simulation).
      On décrit le monde à la machine — pente, vent, roulement, pénétration —
      et elle calcule la force : c'est le seul des trois modes FTMS où la même
      pente donne la même sensation sur deux machines différentes. Le gabarit
      du coureur part avec, pour qu'elle applique notre modèle et non le sien
- [x] Rythme d'écriture arbitré (`createGradeWriter`) : trop souvent, la file
      BLE déborde et la machine applique une pente périmée ; trop rarement,
      l'autorisation de commande expire au bout d'une minute et la machine
      cesse d'obéir en pleine côte, sans rien dire
- [x] `Reset` en quittant : sans lui, le home-trainer reste bloqué sur la
      dernière pente de la séance
- [ ] **Rien n'a été essayé avec un vrai capteur, ni avec une vraie machine.**
      Trames et décisions d'écriture sont testées sur des octets construits à
      la main ; la liaison Bluetooth elle-même ne peut pas l'être sans matériel
- [ ] Pente atténuée (le « trainer difficulty » des autres applications) :
      envoyer la pente réelle rend certains murs inroulables sur un petit
      braquet. Rien ne l'expose aujourd'hui, la pente part telle quelle
- [ ] Reconnexion automatique après une coupure (aujourd'hui : retour à l'état
      « non connecté », il faut réappairer)
- [ ] Étendre `RiderModel.advance` pour accepter une cadence réelle. Il ne
      connaît que le « pace » de Dot Racing (1..10) ou une cadence déduite de la
      vitesse ; avec un capteur, on a mieux

## L5 — Multijoueur — **en partie**

- [x] Hébergement tranché : **Cloudflare Durable Objects**, et non Supabase
      comme le supposait la recommandation. Le client n'a ainsi aucune
      dépendance — le `WebSocket` du navigateur et des trames JSON suffisent —
      et le transport tient derrière `useRoom`. Supabase reste disponible pour
      les comptes du lot 6, qui ne demandent rien de temps réel. Serveur dans
      `multiplayer/`, détails dans [`multijoueur.md`](multijoueur.md)
- [x] Une salle par parcours, sans code d'invitation : la salle **est**
      l'empreinte géométrique du tracé, donc deux personnes qui importent le
      même GPX s'y retrouvent sans s'être rien dit
- [x] Chaque client publie `(pseudo, distance, puissance)` à 4 Hz. Le cap et
      les coordonnées n'y sont pas : la salle étant un parcours, une abscisse
      suffit à retrouver position, cap et pente par `RoutePath.positionAt` —
      moins d'octets, et les autres restent sur la chaussée dans les virages
- [x] Client-autoritaire, aucune anti-triche. Dit sur l'écran d'accueil
- [x] `riderCrowd.js` branché sur ce flux, sans ombre ni lumière
- [x] Interpolation entre deux diffusions par `raceClock.js`, avec ses propres
      constantes : les valeurs par défaut visent un moteur qui diffuse toutes
      les cinq secondes et imposeraient quatre secondes de retard — trente
      mètres d'erreur sur le voisin de roue
- [x] Classement live (`RaceStandings.vue`). Écrit ici plutôt que repris de
      Dot Racing : `Leaderboard.vue` y est adossé à l'API de course et à ses
      participations, dont rien n'existe ici
- [ ] **Rien n'a été essayé à plusieurs.** Les modules purs sont testés ; la
      liaison, le rendu du peloton et la reconnexion demandent deux
      navigateurs et deux personnes
- [ ] Pas d'avatars ni de chevrons de bord : un coureur hors de la bulle
      (au-delà de 900 m) n'est indiqué qu'au classement
- [ ] Pas de salon d'attente ni de départ groupé : on entre et on roule

## L6 — Finir la boucle

- [ ] Accueil : le poids manque encore (parcours, pseudo et appairage y sont)
- [ ] Fin de séance : distance, temps, puissance moyenne, dénivelé
- [ ] Export `.fit` ou `.gpx` — c'est ce qui fait revenir les gens
- [ ] Comptes et historique. Supabase reste le candidat : le lot 5 n'a rien
      engagé de ce côté — son serveur de salles ne stocke rien et ne connaît
      personne

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
| Le matériel n'a jamais été branché | ni capteur, ni home-trainer piloté, ni seconde personne dans une salle : tout ce qui touche au Bluetooth et au réseau est vérifié sur des octets et des horloges simulées, jamais en situation |
