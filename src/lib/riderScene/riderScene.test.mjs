/*
 * Tests unitaires de la partie « coureur » de la scène 3D — ce qui appartient à
 * Dot Racing et non au générateur de décor : la lecture du flux de positions
 * diffusé par le moteur de course.
 *
 * Aucune dépendance navigateur :
 * `node --test src/lib/riderScene/riderScene.test.mjs` depuis `frontend/`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRaceClock,
  createDistanceFollower,
  shortestAngleDelta,
  normalizeBearing,
} from './raceClock.js';
import { createRiderPose, leanFor, attitudeFromGround, LEAN } from './riderPose.js';
import { buildRoutePath, metersBetween } from './routePath.js';
import { sceneWeatherFor } from './sceneWeather.js';
import { detectWebglSupport } from './webglSupport.js';
import { selectCrowd, lateralOffsetFor, offsetRight, offsetBy, CROWD_ENTER_M, CROWD_LEAVE_M } from './riderCrowd.js';
import { createMotionMeter, shortestRadianDelta } from './motionMeter.js';

const close = (actual, expected, tolerance, label = '') =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label} : ${actual} ≠ ${expected} (± ${tolerance})`
  );

const DEG = Math.PI / 180;

/*
 * Tous les tests géographiques se placent à la latitude 0 : un degré y vaut la
 * même chose en longitude et en latitude, les mètres se lisent donc directement
 * dans les coordonnées.
 */
const M_PER_DEG = 111194.93;
const deg = (meters) => meters / M_PER_DEG;

// --- Angles -----------------------------------------------------------------

test('l’écart de cap emprunte toujours le chemin le plus court', () => {
  close(shortestAngleDelta(350, 10), 20, 1e-12, 'passage par le nord');
  close(shortestAngleDelta(10, 350), -20, 1e-12);
  close(shortestAngleDelta(0, 180), 180, 1e-12, 'la borne haute est conservée');
  close(shortestAngleDelta(0, -180), 180, 1e-12, 'l’ambiguïté est levée du même côté');
  close(normalizeBearing(-90), 270, 1e-12);
  close(normalizeBearing(450), 90, 1e-12);
});

// --- L'horloge de course ----------------------------------------------------

/**
 * Déroule un flux d'états et rend des images entre deux arrivées, comme la
 * boucle de rendu.
 *
 * @param {Object} plan
 * @param {number[]} plan.arrivals   intervalles **réels** entre arrivées, en secondes.
 * @param {number[]} plan.gameSteps  temps de **jeu** couvert par chaque état.
 * @param {number} plan.speedMs      vitesse du coureur dans la course.
 * @returns {{samples:Array, minSpeed:number, maxSpeed:number, backwards:number}}
 */
function play({ arrivals, gameSteps, speedMs = 10, frameS = 1 / 60, clock, follower }) {
  const track = clock ?? createRaceClock();
  const smoother = follower ?? createDistanceFollower();

  let gameTime = 1000;
  let distance = 0;
  track.push({ t: gameTime, d: distance, lng: 0, lat: 0, bearing: 0 }, speedMs);

  const samples = [];
  let minSpeed = Infinity;
  let maxSpeed = 0;
  let backwards = 0;
  let previous = null;
  let elapsed = 0;

  for (let i = 0; i < arrivals.length; i++) {
    const step = gameSteps[i] ?? gameSteps[gameSteps.length - 1];
    gameTime += step;
    distance += speedMs * step;
    track.push({ t: gameTime, d: distance, lng: 0, lat: deg(distance), bearing: 0 }, speedMs);

    for (let t = 0; t < arrivals[i]; t += frameS) {
      track.advance(frameS);
      const at = track.distanceAt();
      smoother.follow(at.d, at.v * track.rate, frameS);
      elapsed += frameS;
      if (previous != null && smoother.distance < previous - 1e-9) backwards++;
      previous = smoother.distance;
      // On laisse passer les premières secondes : l'amorce part d'une vitesse
      // supposée, pas mesurée.
      if (elapsed > 3) {
        minSpeed = Math.min(minSpeed, smoother.speed);
        maxSpeed = Math.max(maxSpeed, smoother.speed);
      }
      samples.push({ elapsed, d: smoother.distance, v: smoother.speed });
    }
  }

  return { samples, minSpeed, maxSpeed, backwards, clock: track, follower: smoother };
}

test('le coureur roule dès la première image, sans dix secondes de statue', () => {
  // C'est ce que l'amorce achète : la vitesse annoncée par le moteur suffit à
  // poser un état fictif en amont, donc une pente, donc du mouvement.
  const clock = createRaceClock();
  const follower = createDistanceFollower();
  clock.push({ t: 1000, d: 0, lng: 0, lat: 0, bearing: 0 }, 10);
  follower.follow(clock.distanceAt().d, 10, 0);
  const start = follower.distance;

  for (let i = 0; i < 60; i++) {
    clock.advance(1 / 60);
    const at = clock.distanceAt();
    follower.follow(at.d, at.v * clock.rate, 1 / 60);
  }

  close(follower.speed, 10, 1.5, 'la première seconde se roule à la vitesse annoncée');
  close(follower.distance - start, 10, 2, 'dix mètres parcourus en une seconde');

  // La lecture démarre en retard d'un cran — elle montre où le coureur était il
  // y a quatre secondes —, et le suiveur se pose de lui-même sur cette
  // consigne. L'y poser d'autorité sur la distance annoncée le ferait freiner
  // pour « revenir » à un point que la lecture n'a pas encore atteint.
  assert.ok(start < 0, `la lecture part en amont de l’état reçu : ${start} m`);
});

test('sans vitesse connue à l’amorce, la lecture attend un état, pas deux', () => {
  const clock = createRaceClock();
  const follower = createDistanceFollower();
  clock.push({ t: 1000, d: 0, lng: 0, lat: 0, bearing: 0 });
  for (let i = 0; i < 60; i++) {
    clock.advance(1 / 60);
    const at = clock.distanceAt();
    follower.follow(at.d, at.v * clock.rate, 1 / 60);
  }
  close(follower.distance, 0, 1e-9, 'rien à lire, rien ne bouge');

  // Un seul état de plus, et le coureur part : l'ancienne lecture en exigeait
  // deux, soit dix secondes d'immobilité.
  clock.push({ t: 1005, d: 50, lng: 0, lat: deg(50), bearing: 0 });
  for (let i = 0; i < 120; i++) {
    clock.advance(1 / 60);
    const at = clock.distanceAt();
    follower.follow(at.d, at.v * clock.rate, 1 / 60);
  }
  assert.ok(follower.speed > 3, `le coureur a démarré : ${follower.speed} m/s`);
});

test('sans tracé non plus, la lecture roule dès la première image', () => {
  // Le repli en droit — un autre coureur, un itinéraire fraîchement recalculé
  // dont la trace commence ici — doit lui aussi partir tout de suite. L'amorce
  // recule donc la position de départ le long du cap, au lieu de la recopier :
  // sans cela, la lecture interpolerait entre deux points identiques.
  const clock = createRaceClock();
  clock.push({ t: 1000, d: null, lng: 0, lat: 0, bearing: 0 }, 10);

  const before = clock.positionAt();
  assert.ok(before.lat < -deg(30), `la lecture part en amont : ${before.lat / deg(1)} m`);
  for (let i = 0; i < 60; i++) clock.advance(1 / 60);
  const after = clock.positionAt();
  close((after.lat - before.lat) / deg(1), 10, 2, 'dix mètres parcourus en une seconde');

  // Et sans cap connu, on ne recule rien : un cap absent n'est pas un cap au nord.
  const blind = createRaceClock();
  blind.push({ t: 1000, d: null, lng: 2, lat: 47 }, 10);
  const at = blind.positionAt();
  close(at.lat, 47, 1e-12);
  close(at.lng, 2, 1e-12);
});

test('un flux régulier se lit à vitesse constante, sans jamais reculer', () => {
  const result = play({
    arrivals: Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? 5.6 : 4.8)),
    gameSteps: Array.from({ length: 30 }, () => 5),
    speedMs: 10,
  });

  assert.equal(result.backwards, 0, 'jamais un mètre en arrière');
  assert.ok(result.minSpeed > 8, `la vitesse ne s’effondre pas : ${result.minSpeed} m/s`);
  assert.ok(result.maxSpeed < 12.5, `ni ne s’emballe : ${result.maxSpeed} m/s`);
});

test('une mise à jour très en retard ne fige pas le coureur', () => {
  // Le flux s'interrompt douze secondes : l'ancienne lecture immobilisait le
  // coureur sur place dès la réserve vide. Ici la lecture prolonge, puis
  // ralentit doucement — et surtout, elle ne s'arrête pas net.
  const result = play({
    arrivals: [5, 5, 12, 5, 5],
    gameSteps: [5, 5, 5, 12, 5],
    speedMs: 10,
  });

  assert.equal(result.backwards, 0);
  // Pendant les douze secondes de silence la lecture continue de rouler.
  const silence = result.samples.filter((s) => s.elapsed > 12 && s.elapsed < 20);
  const moving = silence.filter((s) => s.v > 2).length;
  assert.ok(moving > silence.length * 0.6, 'le coureur roule pendant la coupure');
});

test('un rattrapage du moteur ne se rejoue pas en sprint', () => {
  // Le serveur a enchaîné huit rounds : quarante secondes de course arrivent
  // d'un coup. L'ancienne lecture les rejouait en cinq — ×8. L'horloge, elle,
  // accélère dans une borne connue et étale le rattrapage.
  const result = play({
    arrivals: [5, 5, 5, 5, 5, 5, 5, 5],
    gameSteps: [5, 5, 40, 5, 5, 5, 5, 5],
    speedMs: 10,
  });

  assert.equal(result.backwards, 0);
  assert.ok(
    result.maxSpeed < 10 * 3.2,
    `la vitesse rendue reste bornée par le taux de l’horloge : ${result.maxSpeed} m/s`
  );
});

test('le taux de lecture reste discret tant que la cadence est normale', () => {
  const clock = createRaceClock();
  let gameTime = 1000;
  clock.push({ t: gameTime, d: 0, lng: 0, lat: 0, bearing: 0 }, 10);

  let worst = 0;
  for (let i = 0; i < 40; i++) {
    // Gigue du réseau dans les deux sens, mais le temps de jeu, lui, est régulier.
    const arrival = i % 2 === 0 ? 5.7 : 4.3;
    gameTime += 5;
    clock.push({ t: gameTime, d: 50 * (i + 1), lng: 0, lat: 0, bearing: 0 });
    for (let t = 0; t < arrival; t += 1 / 30) {
      clock.advance(1 / 30);
      worst = Math.max(worst, Math.abs(clock.rate - 1));
    }
  }

  assert.ok(worst <= 0.15 + 1e-9, `±15 % au plus, mesuré ${(worst * 100).toFixed(1)} %`);
});

test('une distance qui recule renumérote la chronologie au lieu de faire reculer', () => {
  const clock = createRaceClock();
  clock.push({ t: 1000, d: 12000, lng: 0, lat: 0, bearing: 0 });
  clock.push({ t: 1005, d: 12050, lng: 0, lat: deg(50), bearing: 0 });
  // Itinéraire recalculé : les distances repartent d'une autre origine.
  assert.equal(
    clock.push({ t: 1010, d: 400, lng: 0, lat: deg(100), bearing: 0 }),
    'rebased',
    'un recul de distance n’est pas un déplacement'
  );
  assert.equal(clock.sampleCount, 1, 'la chronologie repart de cet état');
  close(clock.distanceAt().d, 400, 1e-9);
});

test('un temps de jeu qui recule repose la lecture', () => {
  const clock = createRaceClock();
  clock.push({ t: 2000, d: 100, lng: 0, lat: 0, bearing: 0 });
  clock.push({ t: 2005, d: 150, lng: 0, lat: 0, bearing: 0 });
  assert.equal(clock.push({ t: 1500, d: 10, lng: 0, lat: 0, bearing: 0 }), 'rebased');
  close(clock.time, 1500, 1e-9, 'l’horloge suit la course, pas l’inverse');
});

test('un état strictement identique remplace, il n’ajoute pas d’intervalle mort', () => {
  const clock = createRaceClock();
  clock.push({ t: 1000, d: 0, lng: 0, lat: 0, bearing: 0 });
  clock.push({ t: 1005, d: 50, lng: 0, lat: deg(50), bearing: 0 });
  assert.equal(clock.push({ t: 1005, d: 50, lng: 0, lat: deg(50), bearing: 90 }), 'merged');
  assert.equal(clock.sampleCount, 2);
  close(clock.distanceAt(1005).d, 50, 1e-9);
});

test('une heure de moteur figée ne fige pas la lecture', () => {
  /*
   * Le cas réel : le delta SSE `race-update` ne transportait pas
   * `race.lastUpdate`, donc le client la gardait à la valeur du dernier
   * full-state. Chaque arrivée annonçait « jeu +0,0 s » tout en apportant
   * soixante mètres de plus. La chronologie n'avançait pas, la lecture sortait
   * de son domaine, la vitesse tombait à zéro et le coureur rampait à la seule
   * vitesse de rattrapage du suiveur.
   *
   * La datation de repli sur le temps réel écoulé rend cela inoffensif.
   */
  const clock = createRaceClock();
  const follower = createDistanceFollower();
  const frozen = 1788350000;

  let distance = 0;
  clock.push({ t: frozen, d: distance, lng: 0, lat: 0, bearing: 0 }, 12);
  assert.equal(clock.dated, true, 'le premier état est daté, lui');

  let slowest = Infinity;
  for (let i = 0; i < 12; i++) {
    // Cinq secondes réelles, soixante mètres de plus, et toujours la même heure.
    for (let k = 0; k < 5 * 60; k++) {
      clock.advance(1 / 60);
      const at = clock.distanceAt();
      follower.follow(at.d, at.v * clock.rate, 1 / 60);
      if (i >= 2) slowest = Math.min(slowest, follower.speed);
    }
    distance += 60;
    clock.push({ t: frozen, d: distance, lng: 0, lat: deg(distance), bearing: 0 });
  }

  assert.equal(clock.dated, false, 'et le journal peut le dire');
  assert.ok(slowest > 9, `la lecture tient les 12 m/s réels : ${slowest} m/s au plus lent`);
  assert.equal(clock.starving, false, 'la chronologie avance toujours');
});

test('un coureur à l’arrêt ne prolonge aucun mouvement', () => {
  const clock = createRaceClock();
  clock.push({ t: 1000, d: 1000, lng: 0, lat: 0, bearing: 0 });
  clock.push({ t: 1005, d: 1050, lng: 0, lat: deg(50), bearing: 0 });
  // Pause déclarée par le moteur : l'immobilité est la vérité, pas une panne
  // de flux. On ne la comble pas.
  clock.push({ t: 1010, d: 1050, lng: 0, lat: deg(50), bearing: 0, moving: false });

  const far = clock.distanceAt(1040);
  close(far.d, 1050, 1e-9, 'aucune prolongation');
  close(far.v, 0, 1e-9);
});

test('la prolongation s’éteint au lieu de s’arrêter net', () => {
  const clock = createRaceClock({ holdS: 6, fadeS: 6 });
  clock.push({ t: 1000, d: 0, lng: 0, lat: 0, bearing: 0 });
  clock.push({ t: 1010, d: 100, lng: 0, lat: deg(100), bearing: 0 }); // 10 m/s

  close(clock.distanceAt(1013).v, 10, 1e-9, 'plein régime pendant la tenue');
  close(clock.distanceAt(1013).d, 130, 1e-9);
  close(clock.distanceAt(1019).v, 5, 1e-9, 'moitié de vitesse à mi-extinction');
  close(clock.distanceAt(1022).v, 0, 1e-9, 'éteinte, sans à-coup');

  // Et la distance ne recule jamais, quelle que soit la profondeur d'appel.
  let previous = -Infinity;
  for (let t = 1010; t < 1060; t += 0.25) {
    const d = clock.distanceAt(t).d;
    assert.ok(d >= previous - 1e-9, `recul à t=${t}`);
    previous = d;
  }
});

test('l’horloge ne s’aventure pas indéfiniment au-delà du dernier état connu', () => {
  const clock = createRaceClock({ maxAheadS: 15 });
  clock.push({ t: 1000, d: 0, lng: 0, lat: 0, bearing: 0 });
  clock.push({ t: 1005, d: 50, lng: 0, lat: deg(50), bearing: 0 });
  for (let i = 0; i < 60 * 120; i++) clock.advance(1 / 60);
  close(clock.time, 1005 + 15, 1e-6, 'plafonnée à son avance maximale');
  assert.equal(clock.starving, true);
});

test('un retour d’onglet repose l’horloge plutôt que de traverser la scène', () => {
  const clock = createRaceClock();
  clock.push({ t: 1000, d: 0, lng: 0, lat: 0, bearing: 0 });
  clock.push({ t: 1005, d: 50, lng: 0, lat: deg(50), bearing: 0 });
  // Dix minutes plus tard, la course en a fait autant.
  clock.push({ t: 1605, d: 6050, lng: 0, lat: deg(6050), bearing: 0 });
  const step = clock.advance(1 / 60);
  assert.equal(step.reseated, true);
  assert.ok(clock.time > 1590, `l’horloge a rejoint la course : ${clock.time}`);
  // Une coupure de dix minutes n'est pas une cadence : elle ne doit pas gonfler
  // le retard de lecture, sans quoi celui-ci resterait à sa borne une minute.
  assert.ok(clock.lagS < 10, `retard de lecture inchangé : ${clock.lagS} s`);
});

// --- Le suiveur de distance -------------------------------------------------

test('le suiveur ne recule jamais, même sur une consigne qui recule', () => {
  const follower = createDistanceFollower();
  follower.seat(1000, 10);
  let previous = 1000;
  for (let i = 0; i < 600; i++) {
    // Consigne absurde : elle recule de dix mètres à chaque image.
    follower.follow(1000 - i * 10, -10, 1 / 60);
    assert.ok(follower.distance >= previous - 1e-9, 'aucun recul rendu');
    previous = follower.distance;
  }
  close(follower.speed, 0, 1e-6, 'il s’arrête, il ne repart pas en arrière');
});

test('le suiveur borne l’accélération et suit une rampe sans retard', () => {
  const follower = createDistanceFollower({ maxAccel: 2.5 });
  follower.seat(0, 0);

  // Consigne : dix mètres par seconde, tout de suite. Le limiteur
  // d'accélération va saturer plusieurs secondes ; c'est exactement là qu'un
  // ressort du second ordre s'emballerait, en accumulant un écart de position
  // qu'il rendrait ensuite en dépassement.
  let target = 0;
  let worst = 0;
  let previousSpeed = 0;
  for (let i = 0; i < 60 * 12; i++) {
    target += 10 / 60;
    follower.follow(target, 10, 1 / 60);
    worst = Math.max(worst, (follower.speed - previousSpeed) * 60);
    previousSpeed = follower.speed;
  }

  assert.ok(worst <= 2.5 + 1e-6, `accélération bornée : ${worst} m/s²`);
  close(follower.speed, 10, 0.05, 'la vitesse de croisière est atteinte');
  assert.ok(follower.speed <= 10 + 6 + 1e-6, 'et sans dépassement hors borne');
  close(follower.distance, target, 0.5, 'et sans retard permanent sur la rampe');
});

// --- Le tracé ---------------------------------------------------------------

/** Itinéraire en L : 100 m plein nord, puis 100 m plein est. */
function elbowRoute() {
  return buildRoutePath([
    { c: [0, 0], d: 0, a: 100 },
    { c: [0, deg(100)], d: 100, a: 110 },
    { c: [deg(100), deg(100)], d: 200, a: 110 },
  ]);
}

test('le tracé se lit par distance, et son cap est la tangente', () => {
  const route = elbowRoute();

  const half = route.locate(50);
  close(half.lat, deg(50), 1e-12, 'à mi-hauteur de la première branche');
  close(half.lng, 0, 1e-12);
  close(route.bearingAt(50), 0, 1e-9, 'plein nord');
  close(route.bearingAt(150), 90, 1e-9, 'plein est');
  close(route.bearingAt(100), 45, 1e-6, 'dans le coude, le cap est déjà en train de tourner');

  assert.equal(route.covers(-1), false);
  assert.equal(route.covers(201), false);
  assert.equal(route.covers(200), true);
});

test('un tracé inexploitable ne casse rien, il n’existe pas', () => {
  assert.equal(buildRoutePath(null), null);
  assert.equal(buildRoutePath([{ c: [0, 0], d: 0 }]), null, 'un point ne fait pas un tracé');
  const route = buildRoutePath([
    { c: [0, 0], d: 0 },
    { c: [0, deg(10)], d: 10 },
    { c: [0, deg(5)], d: 5 },
    { c: [0, deg(10)], d: 10 },
    { c: null, d: 20 },
    { c: [0, deg(30)], d: 30 },
  ]);
  assert.equal(route.length, 3, 'seules les distances strictement croissantes sont gardées');
  close(route.endDistance, 30, 1e-12);
  assert.equal(route.altitudeAt(15), null, 'sans altitude, on n’en invente pas');
  close(route.gradeAt(15), 0, 1e-12);
});

test('la courbure est signée à droite, et nulle en ligne droite', () => {
  const route = elbowRoute();
  close(route.curvatureAt(40), 0, 1e-9, 'ligne droite');
  // Le coude tourne du nord vers l'est : c'est un virage à droite.
  assert.ok(route.curvatureAt(100) > 0, 'nord → est se prend à droite');

  const left = buildRoutePath([
    { c: [0, 0], d: 0 },
    { c: [0, deg(100)], d: 100 },
    { c: [deg(-100), deg(100)], d: 200 },
  ]);
  assert.ok(left.curvatureAt(100) < 0, 'nord → ouest se prend à gauche');
});

test('la pente se lit sur les altitudes de la trace', () => {
  const route = elbowRoute();
  close(route.altitudeAt(50), 105, 1e-9, 'à mi-côte');
  close(route.gradeAt(50), 0.1, 1e-9, 'dix mètres pour cent : 10 %');
  close(route.gradeAt(160), 0, 1e-9, 'la seconde branche est plate');
});

test('la projection retrouve l’abscisse d’une position posée à côté', () => {
  const route = elbowRoute();
  // Vingt mètres à l'est de la première branche, à mi-hauteur.
  const hit = route.projectNear(deg(20), deg(50), 40);
  close(hit.d, 50, 0.5, 'l’abscisse du pied de la perpendiculaire');
  close(hit.distanceM, 20, 0.5, 'et l’écart mesuré');

  // La fenêtre borne la recherche : sur un itinéraire qui repasse au même
  // endroit — aller-retour, boucle —, une projection globale sauterait à
  // l'autre passage. Ici, cherchée autour des 190 m, la même position se
  // projette sur la seconde branche et l'écart mesuré le dit franchement.
  const far = route.projectNear(deg(20), deg(50), 190, 20);
  assert.ok(far.d >= 170 && far.d <= 200, `la recherche reste dans sa fenêtre : ${far.d}`);
  assert.ok(far.distanceM > 45, 'et rapporte un écart qui trahit le mauvais passage');

  assert.equal(route.projectNear(NaN, deg(50), 40), null, 'position illisible');
});

// --- L'assiette et l'inclinaison --------------------------------------------

test('le coureur se penche du côté du virage, jamais de l’autre', () => {
  // Virage à droite : courbure positive, inclinaison positive — vers la droite.
  assert.ok(leanFor(10, 1 / 40) > 0, 'à droite dans un virage à droite');
  assert.ok(leanFor(10, -1 / 40) < 0, 'à gauche dans un virage à gauche');
  close(leanFor(10, 0), 0, 1e-12, 'droit en ligne droite');
  close(leanFor(0.5, 1 / 20), 0, 1e-12, 'droit à l’arrêt');
});

test('l’inclinaison est légère à basse vitesse et franche à haute vitesse', () => {
  const tight = 1 / 15; // virage serré : rayon 15 m

  const slow = leanFor(20 / 3.6, tight) / DEG;
  close(slow, 5, 0.6, 'environ cinq degrés à 20 km/h dans un virage franc');

  const fast = leanFor(50 / 3.6, tight) / DEG;
  assert.ok(fast > 30 && fast <= 35.001, `jusqu’à 35° à 50 km/h : ${fast}°`);

  // Jamais au-delà de la borne haute, quelle que soit la courbure.
  assert.ok(Math.abs(leanFor(60 / 3.6, 1 / 5)) <= LEAN.highLeanRad + 1e-9);

  // Un virage large à haute vitesse penche moins qu'un virage serré.
  assert.ok(leanFor(50 / 3.6, 1 / 300) < leanFor(50 / 3.6, tight));
});

test('l’inclinaison s’engage sans claquer et revient droite', () => {
  const pose = createRiderPose();
  const corner = { speed: 12, curvature: 1 / 40 };

  let worstRate = 0;
  let previous = 0;
  for (let i = 0; i < 60 * 3; i++) {
    pose.update(1 / 60, corner);
    worstRate = Math.max(worstRate, Math.abs(pose.lean - previous) * 60);
    previous = pose.lean;
  }
  close(pose.lean, leanFor(12, 1 / 40), 1e-3, 'la consigne est atteinte');
  assert.ok(worstRate < 4, `sans claquement : ${worstRate} rad/s`);

  for (let i = 0; i < 60 * 3; i++) pose.update(1 / 60, { speed: 12, curvature: 0 });
  close(pose.lean, 0, 1e-3, 'et le coureur se redresse en sortie');
});

test('l’inclinaison anticipe le virage au lieu de le subir', () => {
  const pose = createRiderPose();
  close(pose.lookAheadFor(0), 0, 1e-12, 'à l’arrêt, on ne regarde pas devant');
  close(pose.lookAheadFor(10), 4.5, 1e-9, 'un peu moins d’une demi-seconde de route');
  close(pose.lookAheadFor(60), 22, 1e-9, 'plafonnée : inutile de viser au-delà du virage');
});

test('l’assiette suit le sol rendu, tangage et dévers', () => {
  // Montée : l'avant est plus haut que l'arrière.
  const climb = attitudeFromGround({
    front: { y: 10.1 },
    rear: { y: 10 },
    left: { y: 10 },
    right: { y: 10 },
    spanM: 1,
    widthM: 1,
  });
  assert.ok(climb.pitch > 0, 'nez en l’air dans la montée');
  close(climb.pitch / DEG, Math.atan(0.1) / DEG, 1e-9);
  close(climb.roll, 0, 1e-12, 'route plate en travers');

  // Dévers : le bas-côté gauche est plus haut, le vélo est couché vers la droite.
  const banked = attitudeFromGround({
    front: { y: 10 },
    rear: { y: 10 },
    left: { y: 10.1 },
    right: { y: 10 },
    spanM: 1,
    widthM: 1,
  });
  assert.ok(banked.roll > 0, 'même convention que l’inclinaison : positif à droite');
});

test('l’assiette est bornée : c’est le terrain qui ment, pas le coureur', () => {
  const pose = createRiderPose();
  for (let i = 0; i < 600; i++) pose.update(1 / 60, { pitch: 2, roll: -2 });
  close(pose.pitch / DEG, 25, 1e-6);
  close(pose.roll / DEG, -12, 1e-6);
});

// --- Disponibilité de la 3D ------------------------------------------------

test('la sonde WebGL fait retomber sur la carte au lieu de lever', () => {
  assert.equal(detectWebglSupport(null), false, 'hors navigateur');
  assert.equal(
    detectWebglSupport({ createElement: () => { throw new Error('canvas refusé'); } }),
    false,
    'un navigateur qui refuse le canevas ne casse pas la course'
  );
  assert.equal(
    detectWebglSupport({ createElement: () => ({ getContext: () => null }) }),
    false,
    'aucun contexte disponible'
  );
  assert.equal(
    detectWebglSupport({ createElement: () => ({ getContext: (kind) => (kind === 'webgl' ? {} : null) }) }),
    true,
    'WebGL 1 suffit'
  );
});

// --- Météo de la scène -------------------------------------------------

test('sans code WMO exploitable, la météo de la scène reste indéterminée', () => {
  assert.equal(sceneWeatherFor(null), undefined, 'pas de météo du tout');
  assert.equal(sceneWeatherFor({}), undefined, 'code manquant');
  assert.equal(sceneWeatherFor({ weatherCode: 'inconnu' }), undefined, 'code non numérique');
});

test('un ciel dégagé ne pleut pas et un ciel couvert de pluie forte sature à 1', () => {
  const clear = sceneWeatherFor({ weatherCode: 0, rain: 0, windSpeed: 0 });
  assert.equal(clear.precipitation, 0);
  assert.equal(clear.precipitationType, 'rain');
  assert.ok(clear.cloudCover < 0.2, 'ciel dégagé : peu de nuages');

  const soaked = sceneWeatherFor({ weatherCode: 65, rain: 20, windSpeed: 10 });
  assert.equal(soaked.precipitation, 1, 'la pluie mesurée sature le coefficient');
});

test('un code de neige bascule le type de précipitation sans le WMO pluie', () => {
  const snow = sceneWeatherFor({ weatherCode: 75, rain: null, windSpeed: 5 });
  assert.equal(snow.precipitationType, 'snow');
  assert.ok(snow.precipitation > 0, 'repli sur une intensité par défaut sans mesure de pluie');
});

test('le vent est ramené sur 0..1 et plafonne au-delà de la bourrasque de référence', () => {
  assert.equal(sceneWeatherFor({ weatherCode: 1, windSpeed: 0 }).wind, 0);
  close(sceneWeatherFor({ weatherCode: 1, windSpeed: 45 }).wind, 1, 1e-12);
  close(sceneWeatherFor({ weatherCode: 1, windSpeed: 90 }).wind, 1, 1e-12, 'plafonné au-delà de 45 km/h');
});

test('le brouillard porte une brume, la bruine non', () => {
  assert.ok(sceneWeatherFor({ weatherCode: 45, windSpeed: 0 }).haze > 0);
  assert.equal(sceneWeatherFor({ weatherCode: 51, windSpeed: 0 }).haze, undefined);
});

// --- Les autres coureurs dans la bulle --------------------------------------

// ~0,00001° de longitude ≈ 0,75 m à cette latitude : on raisonne en mètres.
const at = (id, lng, lat, extra = {}) => ({
  _id: id,
  coordinates: { X: lng, Y: lat },
  current: { movementBearing: 90 },
  ...extra,
});
const METER_DEG = 1 / 111320; // en latitude, un degré vaut ~111,3 km

test('la foule ne retient que ce qui tient dans la bulle, le suivi excepté', () => {
  const focus = { lng: 2, lat: 47 };
  const participations = [
    at('moi', 2, 47),
    at('proche', 2, 47 + 200 * METER_DEG),
    at('loin', 2, 47 + 5000 * METER_DEG),
    at('sans-position', 2, 47),
  ];
  delete participations[3].coordinates;

  const selected = selectCrowd({ participations, focusId: 'moi', focus });
  assert.deepEqual(selected.map((e) => e.id), ['proche'], 'le suivi et le lointain restent dehors');
});

test('la foule est triée par distance et plafonnée', () => {
  const focus = { lng: 2, lat: 47 };
  const participations = [400, 100, 300, 200].map((m, i) =>
    at(`p${m}`, 2, 47 + m * METER_DEG)
  );

  const selected = selectCrowd({ participations, focusId: 'moi', focus, max: 2 });
  assert.deepEqual(selected.map((e) => e.id), ['p100', 'p200'], 'les plus proches d’abord');
});

test('un coureur déjà présent ne sort qu’au seuil de sortie', () => {
  const focus = { lng: 2, lat: 47 };
  const between = (CROWD_ENTER_M + CROWD_LEAVE_M) / 2;
  const participations = [at('voisin', 2, 47 + between * METER_DEG)];

  assert.equal(
    selectCrowd({ participations, focusId: 'moi', focus }).length,
    0,
    'trop loin pour entrer'
  );
  assert.equal(
    selectCrowd({ participations, focusId: 'moi', focus, present: new Set(['voisin']) }).length,
    1,
    'mais pas assez pour ressortir : c’est l’hystérésis'
  );
});

test('l’écart latéral se tire de l’identifiant, et jamais du rang', () => {
  const a = lateralOffsetFor('64f1c2aa00000000000000a1');
  assert.equal(a, lateralOffsetFor('64f1c2aa00000000000000a1'), 'stable d’un passage à l’autre');
  assert.notEqual(a, lateralOffsetFor('64f1c2aa00000000000000a2'), 'deux coureurs ne se superposent pas');
  for (const id of ['a', 'bb', 'ccc', '64f1c2aa00000000000000a1']) {
    const offset = Math.abs(lateralOffsetFor(id));
    assert.ok(offset >= 0.7 && offset <= 1.6, `${id} reste sur la chaussée : ${offset}`);
  }
});

// --- Mesure du mouvement rendu ----------------------------------------------

test('la mesure du mouvement lisse la vitesse et ignore les sauts', () => {
  const meter = createMotionMeter();

  // Premier appel : rien à comparer, la mesure reste nulle.
  assert.equal(meter.measure(0, 0, 0, 0.016).speed, 0);

  // 10 m/s tenus : la mesure converge dessus sans jamais le dépasser.
  let x = 0;
  for (let i = 0; i < 300; i++) {
    x += 10 * 0.016;
    meter.measure(x, 0, 0, 0.016);
  }
  close(meter.state.speed, 10, 0.2, 'vitesse tenue');

  // Un saut de rattrapage n'est pas une vitesse.
  meter.measure(x + 5000, 0, 0, 0.016);
  close(meter.state.speed, 10, 0.5, 'le saut est écarté');

  meter.reset();
  assert.equal(meter.state.speed, 0, 'la remise à zéro oublie le déplacement');
});

test('le lacet passe la couture des caps sans à-coup', () => {
  close(shortestRadianDelta(Math.PI - 0.1, -Math.PI + 0.1), 0.2, 1e-12, 'le plus court chemin');
  close(shortestRadianDelta(0.1, -0.1), -0.2, 1e-12);

  const meter = createMotionMeter();
  meter.measure(0, 0, Math.PI - 0.01, 0.016);
  const { turn } = meter.measure(0.16, 0, -Math.PI + 0.01, 0.016);
  assert.ok(Math.abs(turn) < 1, `un demi-tour apparent n’en est pas un : ${turn}`);
});

test('le rangement de front se fait à droite du cap, en mètres justes', () => {
  const lng = 2;
  const lat = 47;

  // Cap au nord : la droite est plein est.
  const east = offsetRight(lng, lat, 0, 100);
  close(east.lat, lat, 1e-9, 'rien vers le nord');
  close(metersBetween(lng, lat, east.lng, east.lat), 100, 0.5, 'cent mètres');
  assert.ok(east.lng > lng, 'à droite d’un cap nord, c’est l’est');

  // Cap à l'est : la droite est plein sud.
  const south = offsetRight(lng, lat, 90, 100);
  close(south.lng, lng, 1e-9);
  assert.ok(south.lat < lat, 'à droite d’un cap est, c’est le sud');

  // Un écart négatif range de l'autre côté, à la même distance.
  const left = offsetRight(lng, lat, 0, -100);
  close(metersBetween(lng, lat, left.lng, left.lat), 100, 0.5);
  assert.ok(left.lng < lng);
});
