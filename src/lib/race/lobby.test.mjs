/*
 * Tests du salon : ce qui rend une salle visible, et son parcours transmissible.
 *
 * Une propriété porte tout le reste, et c'est celle qui casserait en silence :
 * **le tracé qui fait l'aller-retour par le salon doit rendre la même salle.**
 *
 * L'empreinte se tire de la géométrie au mètre près (`routeFingerprint`). Or
 * celui qui importe un GPX ne roule pas sur les coordonnées du fichier : il
 * roule sur celles que son dépôt a retenues, arrondies au millionième de degré.
 * Transmettre les autres ferait tomber l'invité sur une empreinte voisine — et
 * deux personnes qui croient rouler ensemble se retrouveraient dans deux salles
 * vides, sans la moindre erreur à l'écran pour le dire.
 *
 * Le test ci-dessous franchit donc toute la couture, comme `import.test.mjs` le
 * fait pour l'import : points bruts, dépôt, annonce, JSON, réception, dépôt de
 * l'invité, tracé roulable, empreinte.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { lobbyUrl, sanitizeRoom, sanitizeRoomList, roomPoints, roomBody } from './lobby.js';
import { routeFingerprint } from './protocol.js';
import { addToLibrary, unpackPoints } from '../route/library.js';
import { pathFromRawPoints } from '../route/catalog.js';

const M_PER_DEG = 111194.93;

/**
 * Un tracé tel qu'un GPX le livre : des décimales bien au-delà de ce que le
 * dépôt garde. C'est précisément ce surplus qui piège l'empreinte.
 */
function gpxPoints(count = 40, stepM = 25) {
  const points = [];
  for (let i = 0; i < count; i++) {
    points.push({
      lng: 5.1234567891 + (i * stepM) / M_PER_DEG,
      lat: 44.9876543219 + i * 1e-7,
      ele: 300 + Math.sin(i / 4) * 12.345678,
    });
  }
  return points;
}

/** Ce que fait l'application entre le dépôt d'un fichier et le premier tour de
 *  roue : ranger, puis relire — jamais rouler sur les points d'origine. */
function stored(points, name = 'Parcours') {
  const { routes } = addToLibrary(null, { name, loop: true, points });
  return routes[routes.length - 1];
}

// --- L'aller-retour par le salon --------------------------------------------

test('le tracé transmis par le salon rend la même salle que celui de l’hôte', () => {
  const hote = stored(gpxPoints());
  const salleDeLHote = routeFingerprint(pathFromRawPoints(unpackPoints(hote.coords)));

  // L'hôte annonce, la trame traverse le réseau, l'invité la reçoit.
  const annonce = roomBody({
    host: 'Jean',
    name: 'Ventoux',
    distanceM: 975,
    points: unpackPoints(hote.coords),
  });
  const recu = roomPoints(JSON.parse(JSON.stringify(annonce)));
  assert.ok(recu, 'le tracé reçu doit être exploitable');

  // L'invité le range chez lui, comme n'importe quel parcours, puis roule.
  const invite = stored(recu, 'Ventoux');
  const salleDeLInvite = routeFingerprint(pathFromRawPoints(unpackPoints(invite.coords)));

  assert.equal(salleDeLInvite, salleDeLHote);
});

test('une altitude manquante traverse le salon sans devenir une altitude', () => {
  const points = gpxPoints(10).map((point, i) => (i % 3 === 0 ? { ...point, ele: null } : point));
  const recu = roomPoints(JSON.parse(JSON.stringify(roomBody({ points }))));
  // Zéro serait une altitude — au niveau de la mer —, et la pente est la valeur
  // sensible du jeu : elle entre dans ce que les jambes ressentent.
  assert.equal(recu[0].ele, null);
  assert.equal(recu[3].ele, null);
  assert.ok(Number.isFinite(recu[1].ele));
});

// --- L'annonce ---------------------------------------------------------------

test('un rafraîchissement ne renvoie pas le tracé', () => {
  const body = roomBody({ host: 'Jean', name: 'Ventoux', distanceM: 975 });
  assert.equal(body.coords, undefined);
  assert.equal(body.host, 'Jean');
});

test('une annonce sans pseudo ni nom reste annonçable', () => {
  const body = roomBody({ host: '   ', name: '', distanceM: -5 });
  assert.equal(body.host, 'anonyme');
  assert.equal(body.name, 'Parcours');
  assert.equal(body.distanceM, 0);
});

// --- Ce qui revient du salon -------------------------------------------------

test('une salle sans identifiant exploitable est écartée, pas fatale', () => {
  const rooms = sanitizeRoomList({
    rooms: [
      { id: 'ab12cd34', host: 'Jean', name: 'Ventoux', distanceM: 21300 },
      { id: '../../etc', host: 'Mallory', name: 'x', distanceM: 1 },
      null,
      { host: 'sans identifiant' },
    ],
  });
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0].id, 'ab12cd34');
});

test('un salon illisible rend une liste vide plutôt qu’une exception', () => {
  assert.deepEqual(sanitizeRoomList(null), []);
  assert.deepEqual(sanitizeRoomList({ rooms: 'beaucoup' }), []);
});

test('un pseudo de contrôle ne brouille pas la liste', () => {
  const room = sanitizeRoom({ id: 'ab12cd34', host: 'Jean\r\nADMIN', name: 'Ventoux' });
  assert.equal(room.host, 'JeanADMIN');
});

test('une distance aberrante est bornée, pas recopiée', () => {
  assert.equal(sanitizeRoom({ id: 'ab12cd34', distanceM: 1e12 }).distanceM, 2_000_000);
  assert.equal(sanitizeRoom({ id: 'ab12cd34', distanceM: 'loin' }).distanceM, 0);
});

test('un tracé aberrant est refusé en bloc', () => {
  // Une latitude impossible ne fait pas un coureur mal placé : elle fait
  // exploser la bulle de terrain de celui qui charge le parcours.
  assert.equal(roomPoints({ coords: [5, 4000, 100, 5.1, 4000, 100] }), null);
  assert.equal(roomPoints({ coords: [5, 44, 100] }), null, 'un point isolé n’est pas un tracé');
  assert.equal(roomPoints({ coords: 'un tracé' }), null);
  assert.equal(roomPoints(null), null);
});

test('un tracé dont un seul point est aberrant garde les autres', () => {
  // Ici on peut trier : le point hors Terre est retiré, le reste est valable.
  const points = roomPoints({ coords: [5, 44, 100, 999, 44, 100, 5.001, 44, 100] });
  assert.equal(points.length, 2);
});

// --- L'adresse ---------------------------------------------------------------

test('le salon se lit en HTTP là où les salles parlent WebSocket', () => {
  assert.equal(lobbyUrl('wss://salles.exemple.workers.dev'), 'https://salles.exemple.workers.dev/lobby');
  assert.equal(lobbyUrl('ws://127.0.0.1:8787'), 'http://127.0.0.1:8787/lobby');
  assert.equal(lobbyUrl('ws://127.0.0.1:8787/', '/ab12cd34'), 'http://127.0.0.1:8787/lobby/ab12cd34');
  assert.equal(lobbyUrl(null), null);
});
