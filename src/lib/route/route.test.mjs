/*
 * Tests du parcours : lecture d'un GPX, lissage de l'altitude, abscisse.
 *
 * Le lissage a sa propre batterie parce qu'il porte la seule valeur que les
 * jambes ressentent directement — la pente. Un lissage trop court laisse le
 * bruit du GPS entrer dans le calcul de vitesse ; trop long, il rabote les
 * raidillons. Les deux cas sont testés, dans les deux sens.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseGpxTrackPoints, smoothAltitudes, buildRoutePoints, routePointsFromGpx } from './gpx.js';
import { buildRoutePath } from '../riderScene/routePath.js';

const close = (actual, expected, tolerance, label = '') =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label} : ${actual} ≠ ${expected} (± ${tolerance})`
  );

/* Latitude 0 : un degré vaut la même chose dans les deux axes, les mètres se
 * lisent donc directement dans les coordonnées. Même convention que les tests
 * de la scène. */
const M_PER_DEG = 111194.93;
const deg = (meters) => meters / M_PER_DEG;

/** Un GPX d'une ligne droite vers l'est, un point tous les `stepM` mètres. */
function gpxLine(count, stepM, elevationAt = () => 0) {
  const points = [];
  for (let i = 0; i < count; i++) {
    points.push(
      `<trkpt lat="0.0" lon="${deg(i * stepM)}"><ele>${elevationAt(i * stepM)}</ele></trkpt>`
    );
  }
  return `<?xml version="1.0"?><gpx><trk><trkseg>${points.join('')}</trkseg></trk></gpx>`;
}

// --- Lecture du GPX ---------------------------------------------------------

test('un GPX ordinaire livre ses points, coordonnées et altitudes', () => {
  const points = parseGpxTrackPoints(gpxLine(4, 10, (m) => 100 + m / 10));
  assert.equal(points.length, 4);
  close(points[0].lat, 0, 1e-12, 'latitude');
  close(points[3].lng, deg(30), 1e-12, 'longitude du dernier point');
  close(points[3].ele, 103, 1e-9, 'altitude du dernier point');
});

test('un point sans altitude reste un point, il ne disparaît pas', () => {
  const gpx =
    '<gpx><trkseg><trkpt lat="0" lon="0"><ele>10</ele></trkpt>' +
    '<trkpt lat="0" lon="0.001"></trkpt></trkseg></gpx>';
  const points = parseGpxTrackPoints(gpx);
  assert.equal(points.length, 2);
  assert.equal(points[1].ele, null, "l'altitude est inconnue, pas nulle");
});

test('un trkpt auto-fermant est lu comme les autres', () => {
  const gpx = '<gpx><trkseg><trkpt lat="0" lon="0"/><trkpt lat="0" lon="0.001"/></trkseg></gpx>';
  assert.equal(parseGpxTrackPoints(gpx).length, 2);
});

test('un fichier sans trace exploitable lève au lieu de rendre un demi-tracé', () => {
  assert.throws(() => parseGpxTrackPoints('<gpx></gpx>'), /exploitable/);
  assert.throws(() => parseGpxTrackPoints(''), /vide/);
});

test('une coordonnée hors du monde est écartée, pas convertie', () => {
  const gpx =
    '<gpx><trkseg><trkpt lat="0" lon="0"/><trkpt lat="91" lon="0"/>' +
    '<trkpt lat="0" lon="0.001"/></trkseg></gpx>';
  assert.equal(parseGpxTrackPoints(gpx).length, 2);
});

test('lat et lon se lisent dans n’importe quel ordre', () => {
  // Rien dans GPX n'impose l'ordre, et les exportateurs se partagent les deux
  // usages. Un fichier « lon d'abord » ne doit pas rendre un tracé vide.
  const gpx =
    '<gpx><trkseg><trkpt lon="0" lat="0"><ele>10</ele></trkpt>' +
    '<trkpt lon="0.001" lat="0"><ele>12</ele></trkpt></trkseg></gpx>';
  const points = parseGpxTrackPoints(gpx);
  assert.equal(points.length, 2);
  assert.equal(points[1].ele, 12);
});

test('les attributs entre apostrophes se lisent comme les autres', () => {
  const gpx = "<gpx><trkseg><trkpt lat='0' lon='0'/><trkpt lat='0' lon='0.001'/></trkseg></gpx>";
  assert.equal(parseGpxTrackPoints(gpx).length, 2);
});

test('un espace de noms sur les balises ne cache pas la trace', () => {
  const gpx =
    '<gpx:gpx><gpx:trkseg><gpx:trkpt lat="0" lon="0"><gpx:ele>5</gpx:ele></gpx:trkpt>' +
    '<gpx:trkpt lat="0" lon="0.001"><gpx:ele>7</gpx:ele></gpx:trkpt></gpx:trkseg></gpx:gpx>';
  const points = parseGpxTrackPoints(gpx);
  assert.equal(points.length, 2);
  assert.equal(points[1].ele, 7);
});

test('un fichier qui n’a qu’un itinéraire se lit quand même', () => {
  // Un site de parcours exporte volontiers un <rte> plutôt qu'un <trk>.
  const gpx =
    '<gpx><rte><rtept lat="0" lon="0"><ele>100</ele></rtept>' +
    '<rtept lat="0" lon="0.002"><ele>110</ele></rtept></rte></gpx>';
  const points = parseGpxTrackPoints(gpx);
  assert.equal(points.length, 2);
  assert.equal(points[0].ele, 100);
});

test('quand le fichier porte les deux, la trace prime sur l’itinéraire', () => {
  /*
   * Un <rte> ne compte souvent qu'une poignée de points de passage, là où le
   * <trk> porte la polyligne dense. Les concaténer ferait couper le coureur à
   * travers champs entre deux virages ; il faut choisir, et choisir la trace.
   */
  const gpx =
    '<gpx>' +
    '<rte><rtept lat="10" lon="10"/><rtept lat="10" lon="10.5"/></rte>' +
    '<trk><trkseg><trkpt lat="0" lon="0"/><trkpt lat="0" lon="0.001"/>' +
    '<trkpt lat="0" lon="0.002"/></trkseg></trk>' +
    '</gpx>';
  const points = parseGpxTrackPoints(gpx);
  assert.equal(points.length, 3, 'les trois points de la trace');
  assert.equal(points[0].lat, 0, 'et pas ceux de l’itinéraire');
});

test('plusieurs segments se lisent à la suite', () => {
  const gpx =
    '<gpx><trk>' +
    '<trkseg><trkpt lat="0" lon="0"/><trkpt lat="0" lon="0.001"/></trkseg>' +
    '<trkseg><trkpt lat="0" lon="0.002"/></trkseg>' +
    '</trk></gpx>';
  assert.equal(parseGpxTrackPoints(gpx).length, 3);
});

test('un point sans coordonnée lisible est écarté, il n’interrompt pas la lecture', () => {
  const gpx =
    '<gpx><trkseg><trkpt lat="0" lon="0"/><trkpt lat="" lon="abc"/>' +
    '<trkpt lat="0" lon="0.001"/></trkseg></gpx>';
  assert.equal(parseGpxTrackPoints(gpx).length, 2);
});

test('un GPX qui n’a que des espaces est refusé comme un GPX vide', () => {
  assert.throws(() => parseGpxTrackPoints('   \n  '), /vide/);
});

// --- Le lissage de l'altitude -----------------------------------------------

test('le lissage noie le bruit du GPS : un faux relief redevient plat', () => {
  /*
   * Un point tous les 10 m sur un terrain rigoureusement plat, avec un bruit
   * d'altitude de ±0,5 m — l'ordre de grandeur d'un altimètre barométrique.
   * `gradeAt` mesure déjà sur 40 m, ce qui absorbe une partie du bruit ; mais
   * pas assez : brut, le terrain plat se met à monter et descendre à 2 % et
   * plus, et la vitesse calculée suivrait.
   *
   * Bruit déterministe (aucun `Math.random` dans un test) : la même graine
   * donne le même relief, donc le même verdict.
   */
  const noise = (i) => 0.5 * Math.sin(i * 2.399963) * Math.cos(i * 1.7);
  const raw = Array.from({ length: 101 }, (_, i) => ({ lng: deg(i * 10), lat: 0, ele: noise(i) }));

  const worstGrade = (path) => {
    let worst = 0;
    for (let d = 50; d <= 950; d += 5) worst = Math.max(worst, Math.abs(path.gradeAt(d)));
    return worst;
  };

  const brut = worstGrade(buildRoutePath(buildRoutePoints(raw, { altitudeWindowM: 0 })));
  const lisse = worstGrade(buildRoutePath(buildRoutePoints(raw, { altitudeWindowM: 50 })));

  assert.ok(brut > 0.015, `sans lissage, le bruit fabrique une pente : ${(brut * 100).toFixed(1)} %`);
  assert.ok(lisse < 0.004, `lissé, le terrain redevient plat : ${(lisse * 100).toFixed(2)} %`);
  assert.ok(lisse < brut / 4, 'et le gain est franc, pas marginal');
});

test('le lissage garde la côte : une vraie pente survit à la moyenne', () => {
  // 5 % sur 600 m, un point tous les 10 m. `gradeAt` rend une tangente.
  const points = buildRoutePoints(
    Array.from({ length: 61 }, (_, i) => ({ lng: deg(i * 10), lat: 0, ele: (i * 10) * 0.05 })),
    { altitudeWindowM: 50 }
  );
  const path = buildRoutePath(points);
  close(path.gradeAt(300), 0.05, 0.003, 'au milieu de la côte, la pente est celle de la côte');
});

test('la fenêtre se compte en mètres et non en points', () => {
  // Deux tracés de même longueur, l'un deux fois plus dense que l'autre : à
  // fenêtre égale en mètres, ils doivent lisser pareil.
  const dense = Array.from({ length: 121 }, (_, i) => ({ lng: deg(i * 5), lat: 0, ele: i % 2 ? 2 : 0 }));
  const sparse = Array.from({ length: 61 }, (_, i) => ({ lng: deg(i * 10), lat: 0, ele: i % 2 ? 2 : 0 }));
  const a = buildRoutePath(buildRoutePoints(dense, { altitudeWindowM: 50 }));
  const b = buildRoutePath(buildRoutePoints(sparse, { altitudeWindowM: 50 }));
  close(a.gradeAt(300), b.gradeAt(300), 0.2, 'même terrain, même pente lue');
});

test('sans aucune altitude connue, le lissage ne fabrique pas de chiffre', () => {
  const out = smoothAltitudes([{ ele: null }, { ele: null }], [0, 10], 50);
  assert.ok(Number.isNaN(out[0]) && Number.isNaN(out[1]), 'NaN, et non zéro');
});

// --- L'abscisse curviligne --------------------------------------------------

test('les points confondus sont écartés : l’abscisse croît strictement', () => {
  const raw = [
    { lng: 0, lat: 0, ele: 0 },
    { lng: 0, lat: 0, ele: 0 },
    { lng: deg(10), lat: 0, ele: 0 },
  ];
  const points = buildRoutePoints(raw);
  assert.equal(points.length, 2, 'le doublon est écarté');
  for (let i = 1; i < points.length; i++) assert.ok(points[i].d > points[i - 1].d);
});

test('un tracé qui se réduit à un point après nettoyage lève', () => {
  assert.throws(
    () => buildRoutePoints([{ lng: 0, lat: 0, ele: 0 }, { lng: 0, lat: 0, ele: 0 }]),
    /inexploitable/
  );
});

test('bout en bout : un GPX devient un tracé lisible par distance', () => {
  const points = routePointsFromGpx(gpxLine(51, 10, (m) => 100 + m * 0.03));
  const path = buildRoutePath(points);

  close(path.endDistance, 500, 1, 'longueur totale');
  const at = path.positionAt(250);
  close(at.lng, deg(250), deg(1), 'position à mi-parcours');
  close(at.bearing, 90, 0.5, 'cap plein est');
  close(path.gradeAt(250), 0.03, 0.002, 'pente lue sur les altitudes lissées');
});
