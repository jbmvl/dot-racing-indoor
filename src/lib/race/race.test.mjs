/*
 * Tests du multijoueur : la trame, la salle, et le peloton.
 *
 * Trois propriétés portent tout le reste, et chacune casse d'une façon
 * différente :
 *
 * 1. **L'empreinte de parcours est la salle.** Deux personnes qui importent le
 *    même GPX doivent tomber ensemble sans s'être rien dit ; deux parcours
 *    différents ne doivent jamais partager une salle ;
 * 2. **Le compteur classe, l'abscisse place.** Les confondre met le coureur du
 *    deuxième tour à trois kilomètres après l'arrivée ;
 * 3. **Ce qui vient du réseau est faux jusqu'à preuve du contraire.** Une
 *    coordonnée aberrante ne produit pas un coureur mal placé : elle fait
 *    exploser la bulle de terrain.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  encodeState,
  sanitizeState,
  sanitizeName,
  sanitizeColor,
  parseMessage,
  routeFingerprint,
  colorFor,
  MAX_NAME_LENGTH,
} from './protocol.js';
import { createPeloton, STALE_MS } from './peloton.js';
import { buildRoutePath } from '../riderScene/routePath.js';

const M_PER_DEG = 111194.93;
const deg = (meters) => meters / M_PER_DEG;

/** Ligne droite vers l'est, comme dans les tests de séance. */
function straight(lengthM, stepM = 10, lat = 0) {
  const points = [];
  for (let d = 0; d <= lengthM; d += stepM) points.push({ c: [deg(d), lat], d, a: 0 });
  return buildRoutePath(points);
}

// --- L'empreinte de parcours ------------------------------------------------

test('le même tracé donne la même salle, deux fois', () => {
  assert.equal(routeFingerprint(straight(2000)), routeFingerprint(straight(2000)));
});

test('deux parcours différents ne partagent pas de salle', () => {
  const ici = routeFingerprint(straight(2000));
  assert.notEqual(ici, routeFingerprint(straight(3000)));
  // Même longueur, ailleurs sur la Terre : c'est un autre parcours.
  assert.notEqual(ici, routeFingerprint(straight(2000, 10, 45)));
});

test('un pas d’échantillonnage différent ne change pas la salle', () => {
  // Le même tracé relu par un autre exportateur, plus ou moins dense : il
  // décrit la même route, donc c'est la même salle.
  assert.equal(routeFingerprint(straight(2000, 10)), routeFingerprint(straight(2000, 5)));
});

test('un tracé inexploitable n’a pas de salle', () => {
  assert.equal(routeFingerprint(null), null);
});

test('la couleur d’un coureur ne change pas entre deux passages', () => {
  // C'est tout ce qui distingue deux silhouettes à cinquante mètres.
  assert.equal(colorFor('abc'), colorFor('abc'));
  assert.match(colorFor('abc'), /^#[0-9a-f]{6}$/);
  assert.notEqual(colorFor('abc'), colorFor('abd'));
});

// --- La trame ---------------------------------------------------------------

test('l’état publié porte les deux distances, jamais une seule', () => {
  const frame = encodeState({
    distanceM: 12345.67,
    routeDistanceM: 2345.67,
    powerW: 243.8,
    speedMs: 8.333,
    laps: 2,
  });
  assert.equal(frame.t, 'at');
  assert.equal(frame.d, 12345.7);
  assert.equal(frame.r, 2345.7);
  assert.equal(frame.w, 244);
  assert.equal(frame.l, 2);
});

test('une valeur illisible part à zéro plutôt que de partir en NaN', () => {
  // Un `NaN` sérialisé devient `null` en JSON, et casse la lecture d'en face.
  const frame = encodeState({ distanceM: Number.NaN, routeDistanceM: 10, powerW: undefined });
  assert.equal(frame.d, 0);
  assert.equal(frame.w, 0);
});

test('un état reçu sans abscisse ne place personne', () => {
  assert.equal(sanitizeState({ id: 'a', d: 100 }), null);
  assert.equal(sanitizeState({ r: 100 }), null);
});

test('un état reçu est borné, pas cru sur parole', () => {
  const state = sanitizeState({ id: 'a', r: -50, d: 1e12, w: 99999, v: 900, l: -3 });
  assert.equal(state.routeDistanceM, 0);
  assert.ok(state.distanceM <= 2_000_000);
  assert.ok(state.powerW <= 2000);
  assert.ok(state.speedMs <= 40);
  assert.equal(state.laps, 0);
});

test('un pseudo est coupé, nettoyé, et jamais vide', () => {
  assert.equal(sanitizeName('  Jean-Baptiste  '), 'Jean-Baptiste');
  assert.equal(sanitizeName(''), 'anonyme');
  assert.equal(sanitizeName('a'.repeat(200)).length, MAX_NAME_LENGTH);
  // Un retour chariot recouvre la ligne précédente d'un classement.
  assert.equal(sanitizeName('Jean\r\nBaptiste'), 'JeanBaptiste');
});

test('une couleur qui n’est pas la nôtre est refusée', () => {
  assert.equal(sanitizeColor('#a1b2c3'), '#a1b2c3');
  assert.equal(sanitizeColor('red'), null);
  assert.equal(sanitizeColor('javascript:void(0)'), null);
});

test('les trames connues se lisent, les autres sont ignorées sans bruit', () => {
  const hello = parseMessage(JSON.stringify({ t: 'hello', id: 'moi', riders: [{ id: 'a', r: 10 }] }));
  assert.equal(hello.type, 'hello');
  assert.equal(hello.id, 'moi');
  assert.equal(hello.riders.length, 1);

  assert.equal(parseMessage(JSON.stringify({ t: 'at', id: 'a', r: 10 })).type, 'state');
  assert.equal(parseMessage(JSON.stringify({ t: 'gone', id: 'a' })).type, 'gone');

  // Ni panne ni exception : une trame inconnue est peut-être d'une version d'après.
  assert.equal(parseMessage(JSON.stringify({ t: 'inconnu' })), null);
  assert.equal(parseMessage('{pas du json'), null);
  assert.equal(parseMessage(JSON.stringify(['tableau'])), null);
});

test('une trame d’accueil ne retient que les coureurs exploitables', () => {
  const hello = parseMessage(
    JSON.stringify({ t: 'hello', id: 'moi', riders: [{ id: 'a', r: 10 }, { id: 'b' }, null] })
  );
  assert.equal(hello.riders.length, 1);
});

// --- Le peloton -------------------------------------------------------------

const state = (id, over = {}) => ({
  id,
  name: id,
  color: null,
  distanceM: 0,
  routeDistanceM: 0,
  powerW: 200,
  speedMs: 8,
  laps: 0,
  ...over,
});

test('un tracé est nécessaire : sans lui, une abscisse ne place personne', () => {
  assert.throws(() => createPeloton({ path: null }), /tracé/);
});

test('un coureur est posé sur le tracé, à son abscisse', () => {
  const path = straight(2000);
  const peloton = createPeloton({ path });
  peloton.push(state('a', { routeDistanceM: 1000 }), 0);

  const [participation] = peloton.participations();
  const attendu = path.positionAt(1000);
  assert.ok(Math.abs(participation.coordinates.X - attendu.lng) < 1e-9);
  assert.ok(Math.abs(participation.coordinates.Y - attendu.lat) < 1e-9);
  // Le cap vient du tracé lui aussi : il n'a pas besoin d'être diffusé.
  assert.ok(Number.isFinite(participation.current.movementBearing));
});

test('l’objet remis à la scène est le même d’une diffusion à l’autre', () => {
  // La foule en garde la référence entre deux `sync` : la remplacer lui
  // laisserait des positions périmées entre les mains.
  const peloton = createPeloton({ path: straight(2000) });
  peloton.push(state('a', { routeDistanceM: 100 }), 0);
  const premier = peloton.participations()[0];
  peloton.push(state('a', { routeDistanceM: 200 }), 250);
  const second = peloton.participations()[0];
  assert.equal(premier, second);
  assert.equal(second.lastDistanceItinerary, 200);
});

test('un coureur à l’arrêt est signalé comme tel', () => {
  // Sinon l'horloge de lecture prolonge sa dernière trajectoire, et il
  // continue de rouler tout seul après s'être arrêté.
  const peloton = createPeloton({ path: straight(2000) });
  peloton.push(state('a', { speedMs: 0 }), 0);
  assert.equal(peloton.participations()[0].current.state, 'idle');
  peloton.push(state('a', { speedMs: 8 }), 250);
  assert.equal(peloton.participations()[0].current.state, 'running');
});

test('un coureur qui se tait finit par quitter la route', () => {
  const peloton = createPeloton({ path: straight(2000) });
  peloton.push(state('a'), 0);
  assert.equal(peloton.prune(STALE_MS - 1), 0);
  assert.equal(peloton.size, 1);
  assert.equal(peloton.prune(STALE_MS + 1), 1);
  assert.equal(peloton.size, 0);
});

test('un hoquet de réseau ne fait pas disparaître le voisin de roue', () => {
  // Deux diffusions manquées à 4 Hz, c'est un demi-quart de seconde : très
  // loin du seuil de péremption.
  const peloton = createPeloton({ path: straight(2000) });
  peloton.push(state('a'), 1000);
  assert.equal(peloton.prune(1500), 0);
});

test('un départ annoncé retire tout de suite', () => {
  const peloton = createPeloton({ path: straight(2000) });
  peloton.push(state('a'), 0);
  peloton.remove('a');
  assert.equal(peloton.size, 0);
});

test('le classement suit le compteur, pas l’abscisse', () => {
  // Le deuxième tour a une petite abscisse et une grande distance : c'est la
  // distance qui dit qui est devant.
  const peloton = createPeloton({ path: straight(2000) });
  peloton.push(state('deuxiemeTour', { distanceM: 2100, routeDistanceM: 100 }), 0);
  peloton.push(state('premierTour', { distanceM: 1900, routeDistanceM: 1900 }), 0);

  const classement = peloton.standings();
  assert.deepEqual(classement.map((r) => r.id), ['deuxiemeTour', 'premierTour']);
  assert.equal(classement[0].rank, 1);
  assert.equal(classement[1].gapM, 200);
});

test('on figure à son propre classement', () => {
  const peloton = createPeloton({ path: straight(2000) });
  peloton.push(state('autre', { distanceM: 500 }), 0);
  const classement = peloton.standings({ id: 'moi', name: 'moi', distanceM: 800, powerW: 250 });
  assert.equal(classement[0].id, 'moi');
  assert.equal(classement[0].self, true);
  assert.equal(classement[0].gapM, 0);
  assert.equal(classement[1].gapM, 300);
});

test('rouler seul donne un classement d’un seul coureur', () => {
  const peloton = createPeloton({ path: straight(2000) });
  const classement = peloton.standings({ id: 'moi', name: 'moi', distanceM: 0 });
  assert.equal(classement.length, 1);
  assert.equal(classement[0].rank, 1);
});
