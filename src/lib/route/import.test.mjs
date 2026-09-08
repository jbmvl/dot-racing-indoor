/*
 * Test de bout en bout de l'import d'un parcours.
 *
 * ## Pourquoi ce fichier existe
 *
 * Chaque module de la chaîne était testé, et tous passaient. L'import échouait
 * pourtant systématiquement, avec un « parcours inexploitable » : `readGpxFile`
 * produisait des points au format **compact** (`{c, d, a}`, l'encodage interne
 * de `buildRoutePath`) et les passait à des fonctions qui attendent le format
 * **brut** (`{lng, lat, ele}`). Aucun test ne franchissait cette couture.
 *
 * La leçon vaut d'être écrite : deux formats de points circulent dans ce
 * dossier, et c'est là que se logent les bugs. Le format brut est le seul qui
 * traverse les modules — c'est celui que le lecteur GPX rend, celui que le
 * dépôt range, celui que `pathFromRawPoints` lit. Le compact est un détail de
 * `buildRoutePath`, produit au dernier moment et jamais stocké.
 *
 * Tout ce qui suit vérifie donc des **enchaînements**, pas des fonctions.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { readGpxFile, pathFromRawPoints, nameFromGpx } from './catalog.js';
import { addToLibrary, readLibrary, unpackPoints, STORAGE_KEY } from './library.js';

const close = (actual, expected, tolerance, label = '') =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label} : ${actual} ≠ ${expected} (± ${tolerance})`
  );

/** Un `File` de test : `readGpxFile` n'a besoin que du nom et du texte. */
const fakeFile = (name, text) => ({ name, text: async () => text });

/** Un GPX plausible : en-tête, espace de noms, nom de trace, altitudes. */
function realisticGpx({ name = 'Col de test', points = 200, stepDeg = 0.0002 } = {}) {
  const trkpts = Array.from({ length: points }, (_, i) => {
    const lon = (5.07 + i * stepDeg).toFixed(7);
    const ele = (300 + Math.sin(i / 20) * 60).toFixed(1);
    return `      <trkpt lat="44.2400000" lon="${lon}"><ele>${ele}</ele><time>2026-01-01T10:00:0${i % 10}Z</time></trkpt>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Test" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${name}</name></metadata>
  <trk>
    <name>${name}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

/** Un `localStorage` de test. */
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
    get raw() {
      return map.get(STORAGE_KEY);
    },
  };
}

// --- La chaîne complète -----------------------------------------------------

test('un GPX déposé devient un parcours roulable', async () => {
  const gpx = realisticGpx();
  const { name, points } = await readGpxFile(fakeFile('col.gpx', gpx));

  assert.equal(name, 'Col de test', 'le nom vient du fichier, pas de son chemin');
  assert.ok(points.length > 100, `${points.length} points lus`);

  // Le format qui circule est le brut : c'est ce que le dépôt sait ranger.
  assert.ok('lng' in points[0] && 'lat' in points[0] && 'ele' in points[0], 'points bruts');

  const path = pathFromRawPoints(points);
  assert.ok(path.endDistance > 1000, `${Math.round(path.endDistance)} m de tracé`);
  assert.ok(Number.isFinite(path.positionAt(500).lng), 'et on peut s’y placer');
});

test('un parcours rangé puis relu donne le même tracé', () => {
  /*
   * L'aller-retour par le dépôt est le second endroit où les deux formats se
   * rencontrent. Une erreur ici ne se verrait qu'au rechargement de la page —
   * bien après l'import, donc bien après qu'on ait cessé de chercher.
   */
  const storage = fakeStorage();
  const raw = Array.from({ length: 120 }, (_, i) => ({
    lng: 5.07 + i * 0.0002,
    lat: 44.24,
    ele: 300 + i * 0.5,
  }));

  const direct = pathFromRawPoints(raw);
  addToLibrary(storage, { name: 'Aller-retour', loop: true, points: raw });
  const relu = pathFromRawPoints(unpackPoints(readLibrary(storage)[0].coords));

  close(relu.endDistance, direct.endDistance, 1, 'même longueur après aller-retour');
  close(relu.gradeAt(500), direct.gradeAt(500), 0.001, 'même pente');
  close(relu.positionAt(500).lng, direct.positionAt(500).lng, 1e-5, 'même position');
});

test('bout en bout : fichier déposé, rangé, relu, roulable', async () => {
  const storage = fakeStorage();
  const { name, points } = await readGpxFile(fakeFile('sortie.gpx', realisticGpx({ name: 'Sortie' })));
  addToLibrary(storage, { name, loop: false, points });

  // Ce que ferait `useRouteLibrary.resolve` au rechargement de la page.
  const entry = readLibrary(storage)[0];
  const path = pathFromRawPoints(unpackPoints(entry.coords));

  assert.equal(entry.name, 'Sortie');
  assert.ok(path.endDistance > 1000);
  assert.ok(Number.isFinite(path.gradeAt(path.endDistance / 2)), 'la pente se lit');
});

// --- Les refus --------------------------------------------------------------

test('un fichier qui n’est pas un GPX est refusé en citant son nom', async () => {
  await assert.rejects(
    () => readGpxFile(fakeFile('photo.jpg', 'quelque chose qui n’est pas du XML')),
    /« photo\.jpg »/
  );
});

test('un GPX à un seul point est refusé à l’import, pas au moment de rouler', async () => {
  const gpx = '<gpx><trk><trkseg><trkpt lat="44" lon="5"><ele>100</ele></trkpt></trkseg></trk></gpx>';
  await assert.rejects(() => readGpxFile(fakeFile('unique.gpx', gpx)), /n’est pas un GPX lisible/);
});

test('un GPX dont tous les points sont confondus est refusé', async () => {
  // Deux points valides, mais au même endroit : le tracé n'a pas de longueur.
  const gpx =
    '<gpx><trk><trkseg><trkpt lat="44" lon="5"/><trkpt lat="44" lon="5"/></trkseg></trk></gpx>';
  await assert.rejects(() => readGpxFile(fakeFile('surplace.gpx', gpx)), /n’est pas un GPX lisible/);
});

test('sans fichier du tout, on le dit', async () => {
  await assert.rejects(() => readGpxFile(null), /aucun fichier/);
});

// --- Le nom ------------------------------------------------------------------

test('à défaut de nom dans le fichier, on prend celui du fichier sans extension', async () => {
  const gpx = '<gpx><trk><trkseg><trkpt lat="44" lon="5"/><trkpt lat="44" lon="5.001"/></trkseg></trk></gpx>';
  const { name } = await readGpxFile(fakeFile('Ma Sortie Du Dimanche.gpx', gpx));
  assert.equal(name, 'Ma Sortie Du Dimanche');
});

test('le nom du fichier prime sur rien, mais le nom interne prime sur lui', () => {
  assert.equal(nameFromGpx('<gpx><metadata><name>Ventoux</name></metadata></gpx>'), 'Ventoux');
  assert.equal(nameFromGpx('<gpx></gpx>'), null);
});
