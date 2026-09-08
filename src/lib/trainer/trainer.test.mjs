/*
 * Tests du décodage BLE Cycling Power.
 *
 * Deux pièges y sont gardés, et ce sont ceux qui font échouer ces lecteurs
 * chez les autres :
 *
 * 1. **Les décalages ne sont pas fixes.** Chaque drapeau présent pousse les
 *    champs suivants. Un lecteur écrit contre son propre capteur marche chez
 *    son auteur et rend n'importe quoi ailleurs ;
 * 2. **Les compteurs 16 bits repassent à zéro.** Sans traitement, la cadence
 *    devient aberrante toutes les minutes environ, au repli de l'horloge.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parsePowerMeasurement,
  createCadenceReader,
  createPowerSmoother,
  unwrap16,
} from './cyclingPower.js';

/**
 * Fabrique une trame. `fields` est une liste de `[bit, octets…]` déjà encodés,
 * posés dans l'ordre des drapeaux, comme le fait un vrai capteur.
 */
function frame(powerW, fields = []) {
  let flags = 0;
  const tail = [];
  for (const [bit, ...bytes] of fields) {
    flags |= 1 << bit;
    tail.push(...bytes);
  }
  const buffer = new ArrayBuffer(4 + tail.length);
  const view = new DataView(buffer);
  view.setUint16(0, flags, true);
  view.setInt16(2, powerW, true);
  tail.forEach((byte, i) => view.setUint8(4 + i, byte));
  return view;
}

/** Les deux uint16 petit-boutistes du champ manivelle. */
const crankField = (revolutions, eventTime) => [
  5,
  revolutions & 0xff,
  (revolutions >> 8) & 0xff,
  eventTime & 0xff,
  (eventTime >> 8) & 0xff,
];

// --- La trame ---------------------------------------------------------------

test('une trame minimale donne la puissance', () => {
  assert.equal(parsePowerMeasurement(frame(212)).powerW, 212);
});

test('une puissance négative est lue comme telle', () => {
  // Certains capteurs en publient en descente : la lire comme un entier non
  // signé donnerait 65 000 watts.
  assert.equal(parsePowerMeasurement(frame(-5)).powerW, -5);
});

test('une trame tronquée lève au lieu de rendre zéro', () => {
  // Zéro passerait pour un coureur à l'arrêt — un mensonge plausible, donc
  // dangereux.
  assert.throws(() => parsePowerMeasurement(new DataView(new ArrayBuffer(3))), /trop courte/);
  assert.throws(() => parsePowerMeasurement(null), /trop courte/);
});

test('la manivelle se lit quels que soient les champs qui la précèdent', () => {
  /*
   * Le cœur du sujet. Trois capteurs, trois trames différentes, la même
   * manivelle : un décalage codé en dur n'en lirait qu'une.
   */
  const nu = parsePowerMeasurement(frame(200, [crankField(1234, 5678)]));
  assert.equal(nu.crankRevolutions, 1234);
  assert.equal(nu.crankEventTime, 5678);

  // Précédée de l'équilibre gauche/droite (bit 0, 1 octet).
  const avecEquilibre = parsePowerMeasurement(frame(200, [[0, 50], crankField(1234, 5678)]));
  assert.equal(avecEquilibre.crankRevolutions, 1234);

  // Précédée de l'équilibre, du couple cumulé (bit 2) et des tours de roue
  // (bit 4, six octets) — le cas d'un home-trainer bavard.
  const bavard = parsePowerMeasurement(
    frame(200, [[0, 50], [2, 0x10, 0x20], [4, 1, 0, 0, 0, 9, 0], crankField(4321, 1111)])
  );
  assert.equal(bavard.crankRevolutions, 4321, 'la manivelle est encore au bon endroit');
  assert.equal(bavard.crankEventTime, 1111);
});

test('un capteur sans manivelle le dit, il n’invente pas un zéro', () => {
  const sample = parsePowerMeasurement(frame(180));
  assert.equal(sample.crankRevolutions, null);
  assert.equal(sample.crankEventTime, null);
});

test('un champ annoncé mais absent ne fait pas lire au-delà de la trame', () => {
  // Drapeau manivelle levé, mais la trame s'arrête : il ne faut pas lire dehors.
  const buffer = new ArrayBuffer(5);
  const view = new DataView(buffer);
  view.setUint16(0, 1 << 5, true);
  view.setInt16(2, 150, true);
  const sample = parsePowerMeasurement(view);
  assert.equal(sample.powerW, 150);
  assert.equal(sample.crankRevolutions, null);
});

// --- Le repli des compteurs -------------------------------------------------

test('la différence de deux compteurs 16 bits passe le repli', () => {
  assert.equal(unwrap16(65530, 4), 10, 'de 65530 à 4, il s’est passé dix pas');
  assert.equal(unwrap16(100, 130), 30);
});

// --- La cadence -------------------------------------------------------------

test('la première trame ne conclut rien, la deuxième donne la cadence', () => {
  const reader = createCadenceReader();
  assert.equal(reader.push({ crankRevolutions: 10, crankEventTime: 1024 }, 0), 0);
  // Un tour en une seconde (1024 unités de 1/1024 s) = 60 tr/min.
  const rpm = reader.push({ crankRevolutions: 11, crankEventTime: 2048 }, 1000);
  assert.ok(Math.abs(rpm - 60) < 0.01, `${rpm} tr/min`);
});

test('quatre-vingt-dix tours par minute se lisent comme tels', () => {
  const reader = createCadenceReader();
  reader.push({ crankRevolutions: 0, crankEventTime: 0 }, 0);
  // Trois tours en deux secondes = 90 tr/min.
  const rpm = reader.push({ crankRevolutions: 3, crankEventTime: 2048 }, 2000);
  assert.ok(Math.abs(rpm - 90) < 0.01, `${rpm} tr/min`);
});

test('la cadence survit au repli de l’horloge de la manivelle', () => {
  /*
   * L'horodatage est un uint16 en 1/1024 s : il fait le tour en 64 secondes.
   * C'est donc un événement fréquent, pas un cas limite exotique — et sans
   * traitement, il produit une cadence de plusieurs milliers de tours/minute.
   */
  const reader = createCadenceReader();
  reader.push({ crankRevolutions: 65534, crankEventTime: 65000 }, 0);
  const rpm = reader.push({ crankRevolutions: 1, crankEventTime: 488 }, 1000);
  // 3 tours, et (488 - 65000 + 65536) = 1024 unités, soit une seconde → 180.
  assert.ok(Math.abs(rpm - 180) < 0.01, `${rpm} tr/min après repli`);
});

test('cesser de pédaler fait tomber la cadence à zéro, sans à-coup', () => {
  const reader = createCadenceReader({ stallMs: 3000 });
  reader.push({ crankRevolutions: 0, crankEventTime: 0 }, 0);
  reader.push({ crankRevolutions: 2, crankEventTime: 1024 }, 1000);
  assert.ok(reader.rpm > 0, 'on pédalait');

  // Le capteur continue d'émettre, mais rien ne tourne : compteurs figés.
  assert.ok(reader.push({ crankRevolutions: 2, crankEventTime: 1024 }, 2000) > 0, 'pas encore');
  assert.equal(reader.push({ crankRevolutions: 2, crankEventTime: 1024 }, 5000), 0, 'là, c’est un arrêt');
});

test('un capteur sans manivelle ne produit aucune cadence', () => {
  const reader = createCadenceReader();
  assert.equal(reader.push({ crankRevolutions: null, crankEventTime: null }, 0), null);
});

test('la remise à zéro oublie tout, y compris le dernier compteur', () => {
  const reader = createCadenceReader();
  reader.push({ crankRevolutions: 0, crankEventTime: 0 }, 0);
  reader.push({ crankRevolutions: 2, crankEventTime: 1024 }, 1000);
  reader.reset();
  assert.equal(reader.rpm, 0);
  assert.equal(reader.push({ crankRevolutions: 500, crankEventTime: 500 }, 2000), 0, 'on repart d’une première trame');
});

// --- Lissage de l'affichage -------------------------------------------------

test('la puissance affichée se moyenne sur sa fenêtre, et l’oublie ensuite', () => {
  const smoother = createPowerSmoother(3000);
  assert.equal(smoother.push(100, 0), 100);
  assert.equal(smoother.push(300, 1000), 200, 'moyenne des deux');
  // À 5 s, les deux premières sont hors fenêtre.
  assert.equal(smoother.push(150, 5000), 150);
});
