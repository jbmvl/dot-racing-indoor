/*
 * Tests du pilotage FTMS — la pente telle qu'elle part vers la machine.
 *
 * C'est la valeur la plus sensible du projet : elle décide de ce que les
 * jambes encaissent. Une erreur d'unité ici ne se voit nulle part — ni message
 * d'erreur, ni trame refusée —, elle se sent seulement, et trop tard. Trois
 * pièges sont donc gardés ligne à ligne :
 *
 * 1. la pente part en **pourcents**, alors que tout le projet manipule une
 *    tangente : un facteur cent qui rendrait tous les cols plats ;
 * 2. `cw` est un **demi-CdA fois la densité de l'air**, pas un CdA ;
 * 3. le bit 0 d'Indoor Bike Data est **inversé** : il annonce la suite, pas la
 *    vitesse. Le lire à l'endroit décale toute la trame.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  encodeSimulation,
  encodeRequestControl,
  encodeReset,
  parseControlResponse,
  parseFeature,
  parseIndoorBikeData,
  windCoefficient,
  createGradeWriter,
  MAX_SIMULATED_GRADE,
  OP_SET_SIMULATION,
  OP_REQUEST_CONTROL,
  OP_RESET,
  OP_RESPONSE,
  RESULT_SUCCESS,
  RESULT_NOT_PERMITTED,
  GRADE_EPSILON,
  MIN_WRITE_INTERVAL_MS,
  KEEPALIVE_INTERVAL_MS,
} from './ftms.js';

const view = (bytes) => new DataView(Uint8Array.from(bytes).buffer);
/** Relit la pente d'une trame de simulation, en tangente. */
const gradeOf = (frame) => new DataView(frame.buffer).getInt16(3, true) / 10000;

test('la trame de simulation porte son code d’ordre et sa taille', () => {
  const frame = encodeSimulation({ grade: 0 });
  assert.equal(frame.length, 7);
  assert.equal(frame[0], OP_SET_SIMULATION);
});

test('une pente de 8 % part en pourcents, pas en tangente', () => {
  const frame = encodeSimulation({ grade: 0.08 });
  // 8 % au centième près : 800, et non 8 — le facteur cent qui rend les cols plats.
  assert.equal(new DataView(frame.buffer).getInt16(3, true), 800);
  assert.equal(gradeOf(frame), 0.08);
});

test('une descente part en négatif', () => {
  const frame = encodeSimulation({ grade: -0.062 });
  assert.equal(new DataView(frame.buffer).getInt16(3, true), -620);
});

test('une pente aberrante est plafonnée plutôt que transmise', () => {
  // Un point d’altitude fautif dans un GPX ne doit pas devenir un mur.
  assert.equal(gradeOf(encodeSimulation({ grade: 3 })), MAX_SIMULATED_GRADE);
  assert.equal(gradeOf(encodeSimulation({ grade: -3 })), -MAX_SIMULATED_GRADE);
  assert.equal(gradeOf(encodeSimulation({ grade: Number.NaN })), 0);
});

test('roulement et pénétration partent à leur résolution', () => {
  const frame = encodeSimulation({ grade: 0, Crr: 0.005, cw: 0.196 });
  assert.equal(frame[5], 50); // 0,005 / 0,0001
  assert.equal(frame[6], 20); // 0,196 / 0,01, arrondi
});

test('le vent part en millimètres par seconde, signé', () => {
  const frame = encodeSimulation({ grade: 0, windMs: -2.5 });
  assert.equal(new DataView(frame.buffer).getInt16(1, true), -2500);
});

test('cw est un demi-CdA, pondéré par la densité de l’air', () => {
  assert.ok(Math.abs(windCoefficient(0.32, 1.225) - 0.196) < 1e-6);
  // En altitude l’air est moins dense : la machine doit opposer moins de vent.
  assert.ok(windCoefficient(0.32, 0.98) < windCoefficient(0.32, 1.225));
});

test('les ordres sans paramètre tiennent en un octet', () => {
  assert.deepEqual([...encodeRequestControl()], [OP_REQUEST_CONTROL]);
  assert.deepEqual([...encodeReset()], [OP_RESET]);
});

test('une réponse dit à quel ordre elle répond, et si elle l’a accepté', () => {
  const ok = parseControlResponse(view([OP_RESPONSE, OP_REQUEST_CONTROL, RESULT_SUCCESS]));
  assert.deepEqual(ok, { requestOp: OP_REQUEST_CONTROL, result: RESULT_SUCCESS, ok: true });

  const refus = parseControlResponse(view([OP_RESPONSE, OP_SET_SIMULATION, RESULT_NOT_PERMITTED]));
  assert.equal(refus.ok, false);
  assert.equal(refus.requestOp, OP_SET_SIMULATION);
});

test('ce qui n’est pas une réponse n’en est pas une', () => {
  // La caractéristique porte d’autres indications : les prendre pour des
  // réponses ferait croire à un ordre accepté.
  assert.equal(parseControlResponse(view([0x04, 0x01, 0x01])), null);
  assert.equal(parseControlResponse(view([OP_RESPONSE, 0x00])), null);
  assert.equal(parseControlResponse(null), null);
});

test('les capacités disent si la machine sait simuler', () => {
  // Deux mots de 32 bits ; le second porte ce qu’on peut imposer.
  const capacites = (target) => {
    const frame = new DataView(new ArrayBuffer(8));
    frame.setUint32(4, target, true);
    return parseFeature(frame);
  };
  assert.equal(capacites(1 << 13).simulation, true);
  assert.equal(capacites(1 << 2).resistance, true);
  assert.equal(capacites(1 << 3).power, true);
  // Un capteur qui publie FTMS sans rien savoir imposer : écrire serait vain.
  assert.deepEqual(capacites(0), { simulation: false, resistance: false, power: false });
  assert.equal(parseFeature(view([0x00])).simulation, false);
});

/** Trame Indoor Bike Data : drapeaux, puis les champs présents dans l’ordre. */
function bikeFrame(flags, bytes) {
  const frame = new DataView(new ArrayBuffer(2 + bytes.length));
  frame.setUint16(0, flags, true);
  bytes.forEach((byte, i) => frame.setUint8(2 + i, byte));
  return frame;
}

test('la vitesse est là quand le bit 0 est à zéro — et pas l’inverse', () => {
  // 30 km/h = 3000 centièmes = 0x0BB8.
  const avec = parseIndoorBikeData(bikeFrame(0x0000, [0xb8, 0x0b]));
  assert.ok(Math.abs(avec.speedMs - 30 / 3.6) < 1e-6);

  // Bit 0 levé : pas de vitesse, et le champ suivant commence tout de suite.
  const sans = parseIndoorBikeData(bikeFrame(0x0001 | (1 << 6), [0xc8, 0x00]));
  assert.equal(sans.speedMs, null);
  assert.equal(sans.powerW, 200);
});

test('cadence et puissance se lisent après la vitesse, à leur résolution', () => {
  // Vitesse (2 o) + cadence (2 o, ½ tr/min) + puissance (2 o).
  const flags = (1 << 2) | (1 << 6);
  const frame = bikeFrame(flags, [0xb8, 0x0b, 0xb4, 0x00, 0xf4, 0x01]);
  const data = parseIndoorBikeData(frame);
  assert.equal(data.cadenceRpm, 90); // 180 demi-tours
  assert.equal(data.powerW, 500);
});

test('les champs qu’on ne lit pas décalent quand même les suivants', () => {
  // Distance totale (uint24) entre la vitesse et la puissance : l’ignorer sans
  // avancer de trois octets ferait lire la puissance dans la distance.
  const flags = (1 << 4) | (1 << 6);
  const frame = bikeFrame(flags, [0xb8, 0x0b, 0x10, 0x27, 0x00, 0x2c, 0x01]);
  assert.equal(parseIndoorBikeData(frame).powerW, 300);
});

test('une puissance négative est rendue telle quelle', () => {
  // Le décodeur ne juge pas : c’est à la couche au-dessus de décider qu’un
  // vélo n’est pas propulsé à reculons.
  const data = parseIndoorBikeData(bikeFrame(0x0001 | (1 << 6), [0xf6, 0xff]));
  assert.equal(data.powerW, -10);
});

test('une trame trop courte pour porter ses drapeaux est signalée', () => {
  assert.throws(() => parseIndoorBikeData(view([0x00])), /trop courte/);
});

test('la première pente s’écrit tout de suite', () => {
  const writer = createGradeWriter();
  assert.equal(writer.shouldWrite(0.05, 0), true);
  writer.commit(0.05, 0);
  assert.equal(writer.grade, 0.05);
});

test('une pente inchangée n’est pas réécrite à chaque image', () => {
  const writer = createGradeWriter();
  writer.commit(0.05, 1000);
  assert.equal(writer.shouldWrite(0.05, 1000 + MIN_WRITE_INTERVAL_MS + 1), false);
  assert.equal(writer.shouldWrite(0.05 + GRADE_EPSILON / 2, 1000 + MIN_WRITE_INTERVAL_MS + 1), false);
});

test('un changement franc de pente passe, mais jamais plus vite que la liaison', () => {
  const writer = createGradeWriter();
  writer.commit(0.05, 1000);
  // Le col a changé de figure, mais l’écriture précédente est encore en vol.
  assert.equal(writer.shouldWrite(0.12, 1000 + MIN_WRITE_INTERVAL_MS - 1), false);
  assert.equal(writer.shouldWrite(0.12, 1000 + MIN_WRITE_INTERVAL_MS + 1), true);
});

test('un plateau interminable produit quand même des écritures', () => {
  // Sans elles, l’autorisation de commande expire et la machine cesse d’obéir
  // — en pleine séance, et sans rien dire.
  const writer = createGradeWriter();
  writer.commit(0, 0);
  assert.equal(writer.shouldWrite(0, KEEPALIVE_INTERVAL_MS - 1), false);
  assert.equal(writer.shouldWrite(0, KEEPALIVE_INTERVAL_MS + 1), true);
});

test('une pente illisible n’écrit rien', () => {
  const writer = createGradeWriter();
  assert.equal(writer.shouldWrite(Number.NaN, 0), false);
  assert.equal(writer.shouldWrite(null, 0), false);
});

test('la remise à zéro oublie la dernière pente transmise', () => {
  // Au rebranchement, la machine ne sait plus rien : la première pente doit
  // repartir, même identique.
  const writer = createGradeWriter();
  writer.commit(0.07, 5000);
  writer.reset();
  assert.equal(writer.grade, null);
  assert.equal(writer.shouldWrite(0.07, 5001), true);
});
