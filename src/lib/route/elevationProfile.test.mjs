/*
 * Tests du profil altimétrique.
 *
 * Le chiffre qui compte ici est le **dénivelé**. C'est celui qu'un cycliste
 * regarde en premier, et c'est aussi le plus facile à calculer faux : compté
 * sur un relevé brut il gonfle du bruit du GPS, compté sur des points
 * échantillonnés il fond. Les deux pièges ont leur test.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { profileStats, sampleProfile, buildProfile, DEFAULT_SAMPLES } from './elevationProfile.js';
import { buildRoutePath } from '../riderScene/routePath.js';
import { buildRoutePoints } from './gpx.js';

const close = (actual, expected, tolerance, label = '') =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label} : ${actual} ≠ ${expected} (± ${tolerance})`
  );

const M_PER_DEG = 111194.93;
const deg = (meters) => meters / M_PER_DEG;

/** Ligne droite vers l'est, un point tous les `stepM`, altitude donnée par `ele`. */
function route(lengthM, stepM, ele) {
  const points = [];
  for (let d = 0; d <= lengthM; d += stepM) {
    points.push({ c: [deg(d), 0], d, a: ele(d) });
  }
  return buildRoutePath(points);
}

// --- Dénivelé ---------------------------------------------------------------

test('une montée régulière donne son dénivelé, et rien en descente', () => {
  const stats = profileStats(route(1000, 10, (d) => d * 0.05));
  close(stats.ascentM, 50, 0.01, 'D+');
  assert.equal(stats.descentM, 0);
  close(stats.minM, 0, 0.01);
  close(stats.maxM, 50, 0.01);
});

test('une bosse compte sa montée et sa descente séparément', () => {
  // Monte de 0 à 100 m sur 500 m, redescend à 20 m sur les 500 suivants.
  const stats = profileStats(route(1000, 10, (d) => (d <= 500 ? d * 0.2 : 100 - (d - 500) * 0.16)));
  close(stats.ascentM, 100, 0.5, 'D+');
  close(stats.descentM, 80, 0.5, 'D−');
});

test('un trou d’altitude n’interrompt pas le compte', () => {
  // Le point du milieu n'a pas d'altitude : on doit relier ses voisins, et non
  // repartir de zéro de part et d'autre.
  const path = buildRoutePath([
    { c: [0, 0], d: 0, a: 100 },
    { c: [deg(10), 0], d: 10, a: NaN },
    { c: [deg(20), 0], d: 20, a: 130 },
  ]);
  close(profileStats(path).ascentM, 30, 0.01);
});

test('un parcours sans aucune altitude le dit, il n’invente pas un profil plat', () => {
  const path = buildRoutePath([
    { c: [0, 0], d: 0, a: NaN },
    { c: [deg(10), 0], d: 10, a: NaN },
  ]);
  const stats = profileStats(path);
  assert.equal(stats.hasElevation, false);
  assert.equal(stats.minM, null, 'null, et non zéro qui serait le niveau de la mer');
});

test('le dénivelé se compte sur tous les points, pas sur ceux qu’on dessine', () => {
  /*
   * Une succession de vraies petites bosses, tous les 20 m. Échantillonner
   * grossièrement avant de sommer en manquerait la plupart : c'est exactement
   * l'erreur que la séparation des deux fonctions évite.
   */
  const path = route(2000, 10, (d) => 100 + 3 * Math.sin((d / 20) * Math.PI));
  const stats = profileStats(path);

  // 100 périodes de 20 m, amplitude 3 m crête à crête de part et d'autre.
  assert.ok(stats.ascentM > 250, `D+ réel conservé : ${Math.round(stats.ascentM)} m`);

  const sommeEchantillonnee = sampleProfile(path, { samples: 40 }).reduce(
    (sum, point, i, all) => (i > 0 && point.y > all[i - 1].y ? sum + point.y - all[i - 1].y : sum),
    0
  );
  assert.ok(
    sommeEchantillonnee < stats.ascentM / 3,
    `et l’échantillonnage l’aurait effondré : ${Math.round(sommeEchantillonnee)} m`
  );
});

test('le lissage d’altitude protège le dénivelé du bruit du GPS', () => {
  /*
   * Terrain rigoureusement plat, bruit de ±0,5 m tous les 10 m. Sans lissage,
   * la somme des montées invente plusieurs dizaines de mètres de D+ sur deux
   * kilomètres — le grief classique fait aux montres.
   */
  const bruit = (i) => 0.5 * Math.sin(i * 2.399963) * Math.cos(i * 1.7);
  const raw = Array.from({ length: 201 }, (_, i) => ({ lng: deg(i * 10), lat: 0, ele: bruit(i) }));

  const brut = profileStats(buildRoutePath(buildRoutePoints(raw, { altitudeWindowM: 0 })));
  const lisse = profileStats(buildRoutePath(buildRoutePoints(raw, { altitudeWindowM: 50 })));

  assert.ok(brut.ascentM > 20, `sans lissage, le bruit devient du dénivelé : ${brut.ascentM.toFixed(1)} m`);
  assert.ok(lisse.ascentM < 3, `lissé, le plat reste plat : ${lisse.ascentM.toFixed(1)} m`);
});

// --- Échantillonnage --------------------------------------------------------

test('la courbe couvre le parcours d’un bout à l’autre', () => {
  const points = sampleProfile(route(5000, 10, () => 200));
  assert.equal(points.length, DEFAULT_SAMPLES);
  close(points[0].x, 0, 1e-9, 'premier point à zéro');
  close(points.at(-1).x, 5, 1e-9, 'dernier point sur la borne exacte, en kilomètres');
});

test('deux densités de GPX du même parcours donnent la même courbe', () => {
  const dense = route(2000, 5, (d) => 100 + d * 0.02);
  const sparse = route(2000, 50, (d) => 100 + d * 0.02);
  const a = sampleProfile(dense, { samples: 50 });
  const b = sampleProfile(sparse, { samples: 50 });
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    close(a[i].y, b[i].y, 0.5, `point ${i}`);
    close(a[i].x, b[i].x, 1e-9, `abscisse ${i}`);
  }
});

test('on ne demande jamais moins de deux points', () => {
  assert.equal(sampleProfile(route(1000, 10, () => 0), { samples: 1 }).length, 2);
});

test('un tracé inexploitable rend une courbe vide, il ne lève pas', () => {
  assert.deepEqual(sampleProfile(null), []);
  assert.deepEqual(sampleProfile(undefined, { samples: 10 }), []);
});

// --- Assemblage -------------------------------------------------------------

test('buildProfile réunit la courbe, le dénivelé et la longueur', () => {
  const profile = buildProfile(route(3000, 10, (d) => 150 + d * 0.01), { samples: 100 });
  assert.equal(profile.hasElevation, true);
  assert.equal(profile.points.length, 100);
  close(profile.lengthM, 3000, 1);
  close(profile.ascentM, 30, 0.5);
});

test('sans altitude, buildProfile le dit clairement', () => {
  const path = buildRoutePath([
    { c: [0, 0], d: 0, a: NaN },
    { c: [deg(10), 0], d: 10, a: NaN },
  ]);
  const profile = buildProfile(path);
  assert.equal(profile.hasElevation, false);
  assert.deepEqual(profile.points, []);
});
