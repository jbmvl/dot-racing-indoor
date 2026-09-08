/*
 * Tests de l'état de séance : le compteur, le tracé et le bouclage.
 *
 * Ce module est court, mais c'est lui qui décide de tout ce que l'œil voit
 * bouger. Les propriétés testées ici sont celles qu'aucune évolution ne doit
 * défaire : la distance n'est pas remise à zéro par un tour, le coureur ne
 * recule jamais, et repasser la ligne est un événement que la scène doit
 * pouvoir voir.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createRideState } from './rideState.js';
import { buildRoutePath } from '../riderScene/routePath.js';

const M_PER_DEG = 111194.93;
const deg = (meters) => meters / M_PER_DEG;

/** Ligne droite vers l'est de `lengthM` mètres, plate ou en pente régulière. */
function straight(lengthM, stepM = 10, gradePct = 0) {
  const points = [];
  for (let d = 0; d <= lengthM; d += stepM) {
    points.push({ c: [deg(d), 0], d, a: (d * gradePct) / 100 });
  }
  return buildRoutePath(points);
}

test('un tracé inexploitable est refusé au montage, pas à la première image', () => {
  assert.throws(() => createRideState({ path: null }), /inexploitable/);
});

test('le compteur avance à la vitesse qu’on lui donne', () => {
  const ride = createRideState({ path: straight(1000), loop: false });
  ride.advance(1, 10);
  assert.equal(ride.distanceM, 10);
  assert.equal(ride.routeDistanceM, 10);
  ride.advance(2, 10);
  assert.equal(ride.distanceM, 30);
});

test('une vitesse négative ne fait pas reculer le coureur', () => {
  const ride = createRideState({ path: straight(1000), loop: false });
  ride.advance(1, 10);
  ride.advance(1, -5);
  assert.equal(ride.distanceM, 10, 'la distance ne bouge pas');
  assert.equal(ride.speedMs, 0, 'et la vitesse rendue est nulle, pas négative');
});

test('une image de durée nulle ne fait rien avancer', () => {
  const ride = createRideState({ path: straight(1000), loop: false });
  ride.advance(0, 10);
  assert.equal(ride.distanceM, 0);
});

test('sur un parcours bouclé, repasser la ligne se signale et compte un tour', () => {
  const ride = createRideState({ path: straight(1000), loop: true });
  assert.equal(ride.lapLengthM, 1000);

  assert.equal(ride.advance(90, 10).wrapped, false, 'on n’a pas encore bouclé');
  const verdict = ride.advance(20, 10);
  assert.equal(verdict.wrapped, true, 'le tour est signalé');
  assert.equal(ride.laps, 1);
  assert.equal(ride.distanceM, 1100, 'le compteur, lui, ne se remet pas à zéro');
  assert.equal(ride.routeDistanceM, 100, 'mais l’abscisse est revenue dans les bornes');
});

test('une seule image peut avaler plusieurs tours sans dérailler', () => {
  const ride = createRideState({ path: straight(500), loop: true });
  ride.advance(10, 160); // 1600 m, soit trois tours et 100 m
  assert.equal(ride.laps, 3);
  assert.equal(ride.routeDistanceM, 100);
  assert.equal(ride.distanceM, 1600);
});

test('un parcours non bouclé s’arrête à la fin au lieu de sortir du tracé', () => {
  const ride = createRideState({ path: straight(500), loop: false });
  ride.advance(10, 100);
  assert.equal(ride.finished, true);
  assert.equal(ride.routeDistanceM, 500, 'on reste sur le dernier point');
  ride.advance(10, 100);
  assert.equal(ride.distanceM, 1000, 'et plus rien ne bouge ensuite');
});

test('la pente se lit sous le coureur, pas au départ du tracé', () => {
  const ride = createRideState({ path: straight(1000, 10, 6), loop: false });
  ride.advance(10, 30);
  assert.ok(Math.abs(ride.gradeAt - 0.06) < 0.005, `pente lue : ${ride.gradeAt}`);
});

test('la position et le cap suivent l’abscisse courante', () => {
  const ride = createRideState({ path: straight(1000), loop: false });
  ride.advance(10, 25);
  const at = ride.positionAt();
  assert.ok(Math.abs(at.lng - deg(250)) < deg(1), 'position à 250 m');
  assert.ok(Math.abs(at.bearing - 90) < 0.5, 'cap plein est');
});

test('on peut démarrer ailleurs qu’au premier point', () => {
  const ride = createRideState({ path: straight(1000), loop: true, startDistanceM: 400 });
  assert.equal(ride.routeDistanceM, 400);
  assert.equal(ride.distanceM, 0, 'le compteur part de zéro, lui');
});

test('la remise à zéro rend la séance neuve, sans changer de parcours', () => {
  const ride = createRideState({ path: straight(500), loop: true });
  ride.advance(100, 10);
  ride.reset();
  assert.equal(ride.distanceM, 0);
  assert.equal(ride.laps, 0);
  assert.equal(ride.routeDistanceM, 0);
});
