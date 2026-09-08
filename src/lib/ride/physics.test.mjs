/*
 * Tests du modèle physique.
 *
 * Deux familles, et la seconde est la raison d'être de la première :
 *
 * 1. la **vitesse d'équilibre** est confrontée à des valeurs qu'un cycliste
 *    reconnaît — 200 W sur le plat, une bosse à 6 %, une descente en roue
 *    libre. Un modèle qui rend 60 km/h à 200 W est faux, même s'il est
 *    parfaitement intégré ;
 * 2. l'**intégrateur** doit converger vers cette vitesse d'équilibre. C'est ce
 *    qui prouve qu'il intègre les bonnes forces, et pas seulement des forces
 *    plausibles.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  airDensity,
  resistanceForces,
  steadyStateSpeed,
  createSpeedIntegrator,
  tractionForce,
  DEFAULT_SETUP,
  MAX_TRACTION_N,
  AIR_DENSITY_SEA_LEVEL,
  GRAVITY,
} from './physics.js';

const kmh = (ms) => ms * 3.6;
const MASS = DEFAULT_SETUP.riderKg + DEFAULT_SETUP.bikeKg;

const close = (actual, expected, tolerance, label = '') =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label} : ${actual} ≠ ${expected} (± ${tolerance})`
  );

// --- Les résistances --------------------------------------------------------

test('sur le plat à l’arrêt, seul le roulement s’oppose', () => {
  const f = resistanceForces({ speedMs: 0, massKg: MASS, CdA: 0.32, Crr: 0.005 });
  assert.equal(f.aero, 0);
  assert.equal(f.gravity, 0);
  close(f.rolling, 0.005 * MASS * GRAVITY, 0.01);
});

test('la gravité suit la pente, en montée comme en descente', () => {
  const up = resistanceForces({ speedMs: 5, grade: 0.08, massKg: MASS, CdA: 0.32, Crr: 0.005 });
  const down = resistanceForces({ speedMs: 5, grade: -0.08, massKg: MASS, CdA: 0.32, Crr: 0.005 });
  assert.ok(up.gravity > 0, 'la montée freine');
  close(down.gravity, -up.gravity, 0.01, 'et la descente pousse d’autant');
});

test('un vent arrière plus rapide que le coureur pousse au lieu de freiner', () => {
  // `windMs` négatif = vent arrière. À 5 m/s de vitesse et 8 m/s de vent
  // arrière, l'air va plus vite que le vélo : la force change de signe.
  const f = resistanceForces({ speedMs: 5, windMs: -8, massKg: MASS, CdA: 0.32, Crr: 0.005 });
  assert.ok(f.aero < 0, `l’aéro devient motrice : ${f.aero.toFixed(1)} N`);
});

test('l’air se raréfie avec l’altitude', () => {
  close(airDensity(0), AIR_DENSITY_SEA_LEVEL, 1e-9);
  assert.ok(airDensity(2000) < AIR_DENSITY_SEA_LEVEL * 0.8, 'à 2 000 m, un cinquième de moins');
  close(airDensity(NaN), AIR_DENSITY_SEA_LEVEL, 1e-9, 'une altitude inconnue vaut le niveau de la mer');
});

// --- Vitesse d'équilibre : les chiffres qu'un cycliste reconnaît ------------

test('200 W sur le plat donnent une trentaine de km/h', () => {
  close(kmh(steadyStateSpeed({ powerW: 200 })), 33.8, 1.5, '200 W à plat');
});

test('quadrupler la puissance ne fait pas quadrupler la vitesse', () => {
  // L'aéro croît en v³ en puissance : c'est la loi la plus contre-intuitive du
  // cyclisme, et un modèle qui la rate ne sert à rien.
  const v200 = steadyStateSpeed({ powerW: 200 });
  const v800 = steadyStateSpeed({ powerW: 800 });
  assert.ok(v800 < v200 * 2, `800 W ne donne pas le double : ${kmh(v800).toFixed(1)} km/h`);
  assert.ok(v800 > v200 * 1.4, 'mais gagne quand même nettement');
});

test('200 W dans une bosse à 6 % : autour de 13 km/h', () => {
  close(kmh(steadyStateSpeed({ powerW: 200, grade: 0.06 })), 13, 1.5, '200 W à 6 %');
});

test('une pente raide à petite puissance se grimpe lentement, elle ne bloque pas', () => {
  /*
   * Le piège que ce test garde. Borner la **vitesse** au dénominateur de `P/v`
   * plafonne du même coup la force à `P/1,5`, et le modèle répond « pente
   * insurmontable » là où l'on grimperait à 4 km/h. C'est la force qu'il faut
   * borner, pas la vitesse.
   */
  const v = steadyStateSpeed({ powerW: 100, grade: 0.1 });
  assert.ok(v > 0, '100 W à 10 % ne sont pas « insurmontables »');
  close(kmh(v), 4.2, 0.8, '100 W à 10 %');

  const raide = steadyStateSpeed({ powerW: 150, grade: 0.2 });
  assert.ok(kmh(raide) > 2 && kmh(raide) < 5, `150 W à 20 % : ${kmh(raide).toFixed(1)} km/h`);
});

test('sans pédaler, on s’arrête sur le plat et on prend de la vitesse en descente', () => {
  assert.equal(steadyStateSpeed({ powerW: 0 }), 0);
  close(kmh(steadyStateSpeed({ powerW: 0, grade: -0.08 })), 63, 4, 'roue libre à -8 %');
});

test('une pente vraiment insurmontable rend zéro, et non une vitesse minuscule', () => {
  assert.equal(steadyStateSpeed({ powerW: 5, grade: 0.25 }), 0);
});

test('l’air raréfié de l’altitude fait gagner de la vitesse à puissance égale', () => {
  const mer = steadyStateSpeed({ powerW: 200, altitudeM: 0 });
  const col = steadyStateSpeed({ powerW: 200, altitudeM: 2000 });
  assert.ok(col > mer, `${kmh(col).toFixed(1)} > ${kmh(mer).toFixed(1)} km/h`);
});

test('un coureur plus lourd grimpe moins vite, à plat il ne change presque rien', () => {
  const leger = steadyStateSpeed({ powerW: 200, grade: 0.06, massKg: 65 });
  const lourd = steadyStateSpeed({ powerW: 200, grade: 0.06, massKg: 95 });
  assert.ok(leger > lourd * 1.25, 'en côte, la masse décide');

  const platLeger = steadyStateSpeed({ powerW: 200, massKg: 65 });
  const platLourd = steadyStateSpeed({ powerW: 200, massKg: 95 });
  close(kmh(platLeger), kmh(platLourd), 1, 'à plat, elle ne pèse que sur le roulement');
});

// --- La force à la roue -----------------------------------------------------

test('la force est plafonnée à l’arrêt, jamais infinie', () => {
  assert.equal(tractionForce(200, 0), MAX_TRACTION_N);
  assert.equal(tractionForce(0, 5), 0, 'sans puissance, pas de force');
  close(tractionForce(200, 10), 20, 1e-9, 'et à vitesse normale, c’est bien P/v');
});

test('le plafond ne mord pas dans les régimes de vélo ordinaires', () => {
  // 100 W à 10 % demandent ~85 N : très en dessous du plafond. S'il mordait
  // là, il fausserait la vitesse d'équilibre au lieu de borner un transitoire.
  assert.ok(tractionForce(100, 1.2) < MAX_TRACTION_N);
});

// --- L'intégrateur ----------------------------------------------------------

/** Fait tourner l'intégrateur `seconds` secondes à 60 images/s. */
function run(integrator, seconds, input) {
  for (let i = 0; i < seconds * 60; i++) integrator.advance(1 / 60, input);
  return integrator.speedMs;
}

test('l’intégrateur converge vers la vitesse d’équilibre — plat, côte, descente', () => {
  for (const [label, input] of [
    ['plat', { powerW: 200 }],
    ['côte à 6 %', { powerW: 200, grade: 0.06 }],
    ['côte raide', { powerW: 100, grade: 0.1 }],
    ['roue libre en descente', { powerW: 0, grade: -0.08 }],
  ]) {
    const integrator = createSpeedIntegrator();
    const reached = run(integrator, 400, input);
    close(kmh(reached), kmh(steadyStateSpeed(input)), 0.2, label);
  }
});

test('la vitesse ne saute pas : c’est l’inertie qui fait la sensation', () => {
  /*
   * Poser la vitesse d'équilibre à chaque image donnerait un vélo sans masse.
   * Après une seconde à 200 W depuis l'arrêt, on doit être loin du compte.
   */
  const integrator = createSpeedIntegrator();
  const apresUneSeconde = run(integrator, 1, { powerW: 200 });
  const equilibre = steadyStateSpeed({ powerW: 200 });
  assert.ok(apresUneSeconde < equilibre * 0.6, `relance progressive : ${kmh(apresUneSeconde).toFixed(1)} km/h`);
  assert.ok(apresUneSeconde > 0.5, 'mais on démarre bien');
});

test('on garde son élan en cessant de pédaler', () => {
  const integrator = createSpeedIntegrator();
  run(integrator, 400, { powerW: 200 });
  const lance = integrator.speedMs;
  const apresTroisSecondes = run(integrator, 3, { powerW: 0 });
  assert.ok(apresTroisSecondes > lance * 0.8, 'la vitesse retombe doucement');
  assert.ok(apresTroisSecondes < lance, 'mais elle retombe');
});

test('le vélo ne recule jamais, même arrêté dans un mur', () => {
  const integrator = createSpeedIntegrator();
  const v = run(integrator, 30, { powerW: 0, grade: 0.15 });
  assert.equal(v, 0);
});

test('une image très longue ne fait pas osciller la vitesse', () => {
  /*
   * Onglet revenu au premier plan, ramasse-miettes : une image peut durer une
   * seconde. Intégrée d'un bloc, elle ferait franchir l'équilibre et osciller.
   * Le pas interne doit rendre le résultat indépendant de la cadence d'image.
   */
  const fin = createSpeedIntegrator();
  const gros = createSpeedIntegrator();
  for (let i = 0; i < 600; i++) fin.advance(1 / 60, { powerW: 250 });
  for (let i = 0; i < 10; i++) gros.advance(1, { powerW: 250 });
  close(kmh(fin.speedMs), kmh(gros.speedMs), 0.5, 'même verdict à 60 im/s et à 1 im/s');
});

test('changer de gabarit en roulant ne fait pas perdre l’élan', () => {
  const integrator = createSpeedIntegrator();
  run(integrator, 60, { powerW: 200 });
  const avant = integrator.speedMs;
  integrator.configure({ riderKg: 90 });
  assert.equal(integrator.speedMs, avant, 'la vitesse ne bouge pas à l’instant du réglage');
  assert.equal(integrator.massKg, 98);
});

test('la remise à zéro repart de l’arrêt, ou d’où on lui dit', () => {
  const integrator = createSpeedIntegrator();
  run(integrator, 60, { powerW: 200 });
  integrator.reset();
  assert.equal(integrator.speedMs, 0);
  integrator.reset(8);
  assert.equal(integrator.speedMs, 8);
  integrator.reset(-3);
  assert.equal(integrator.speedMs, 0, 'une vitesse négative n’a pas de sens');
});
