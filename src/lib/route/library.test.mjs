/*
 * Tests du dépôt de parcours importés.
 *
 * Ce module touche `localStorage`, qui est le composant le plus capricieux du
 * navigateur : il lève en navigation privée, il sature sans prévenir, et son
 * contenu survit à des versions du code qui ne l'attendaient pas. Les tests
 * portent donc autant sur les cas dégradés que sur le cas nominal — un dépôt
 * illisible ne doit jamais empêcher l'application de démarrer.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  packPoints,
  unpackPoints,
  routeIdFor,
  readLibrary,
  writeLibrary,
  addToLibrary,
  removeFromLibrary,
  STORAGE_KEY,
  STORAGE_VERSION,
  MAX_ROUTES,
} from './library.js';

/** Un `localStorage` de test. `failing` simule un quota atteint. */
function fakeStorage({ failing = false, seed = null } = {}) {
  const map = new Map(seed ? [[STORAGE_KEY, seed]] : []);
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      if (failing) throw new Error('QuotaExceededError');
      map.set(k, v);
    },
    removeItem: (k) => map.delete(k),
    get raw() {
      return map.get(STORAGE_KEY);
    },
  };
}

const points = (n, ele = 100) =>
  Array.from({ length: n }, (_, i) => ({ lng: i * 0.001, lat: 45, ele: ele + i }));

// --- Rangement des points ---------------------------------------------------

test('un aller-retour par le rangement conserve les points', () => {
  const original = [
    { lng: 5.123456, lat: 44.987654, ele: 312.4 },
    { lng: 5.124, lat: 44.988, ele: 318.9 },
  ];
  const back = unpackPoints(packPoints(original));
  assert.equal(back.length, 2);
  assert.equal(back[0].lng, 5.123456);
  assert.equal(back[1].ele, 318.9);
});

test('une altitude inconnue reste inconnue, elle ne devient pas zéro', () => {
  const back = unpackPoints(packPoints([{ lng: 0, lat: 0, ele: null }, { lng: 1, lat: 0, ele: NaN }]));
  assert.equal(back[0].ele, null, 'null et non 0 — zéro serait une altitude');
  assert.equal(back[1].ele, null, 'NaN non plus ne traverse pas JSON');
});

test('les coordonnées sont arrondies à la précision utile', () => {
  const flat = packPoints([{ lng: 5.1234567891, lat: 44.9876543219, ele: 312.44444 }]);
  assert.equal(flat[0], 5.123457, 'six décimales suffisent : environ onze centimètres');
  assert.equal(flat[2], 312.4);
});

test('un tableau tronqué se lit jusqu’au dernier point complet', () => {
  assert.equal(unpackPoints([0, 45, 100, 0.001, 45]).length, 1);
  assert.deepEqual(unpackPoints('pas un tableau'), []);
});

// --- Identifiants -----------------------------------------------------------

test('l’identifiant se tire du nom, accents et ponctuation aplanis', () => {
  assert.equal(routeIdFor('Col de la Forclaz — Boucle Été'), 'import-col-de-la-forclaz-boucle-ete');
});

test('redéposer le même fichier remplace au lieu d’empiler', () => {
  const storage = fakeStorage();
  addToLibrary(storage, { name: 'Ma boucle', loop: true, points: points(3) });
  const { routes } = addToLibrary(storage, { name: 'Ma boucle', loop: true, points: points(5) });
  assert.equal(routes.length, 1, 'un seul parcours');
  assert.equal(unpackPoints(routes[0].coords).length, 5, 'et c’est la version récente');
});

test('un nom vide ou illisible donne quand même un identifiant', () => {
  assert.equal(routeIdFor(''), 'import-parcours');
  assert.equal(routeIdFor('!!!'), 'import-parcours');
});

// --- Lecture et écriture ----------------------------------------------------

test('un dépôt vierge se lit comme vide, sans lever', () => {
  assert.deepEqual(readLibrary(fakeStorage()), []);
  assert.deepEqual(readLibrary(null), [], 'même sans stockage du tout');
});

test('un dépôt corrompu ne bloque pas le démarrage', () => {
  assert.deepEqual(readLibrary(fakeStorage({ seed: '{ ceci n est pas du json' })), []);
});

test('un dépôt écrit par une autre version est ignoré, pas interprété', () => {
  const seed = JSON.stringify({ v: STORAGE_VERSION + 1, routes: [{ id: 'x', coords: [] }] });
  assert.deepEqual(readLibrary(fakeStorage({ seed })), []);
});

test('une entrée sans coordonnées est écartée à la lecture', () => {
  const seed = JSON.stringify({
    v: STORAGE_VERSION,
    routes: [{ id: 'bon', coords: [0, 45, 100] }, { id: 'mauvais' }, { coords: [] }],
  });
  const routes = readLibrary(fakeStorage({ seed }));
  assert.equal(routes.length, 1);
  assert.equal(routes[0].id, 'bon');
});

test('un quota atteint ne fait pas échouer l’import, il le rend seulement volatil', () => {
  const storage = fakeStorage({ failing: true });
  const { routes, stored } = addToLibrary(storage, { name: 'Trop gros', loop: false, points: points(3) });
  assert.equal(stored, false, 'l’écriture n’a pas abouti, et on le dit');
  assert.equal(routes.length, 1, 'mais le parcours est utilisable pour la séance');
});

test('au-delà du plafond, les plus anciens sortent', () => {
  const storage = fakeStorage();
  for (let i = 0; i < MAX_ROUTES + 3; i++) {
    // Horodatage croissant : `addToLibrary` s'appuie sur `importedAt`.
    const entry = { name: `Parcours ${i}`, loop: false, points: points(2) };
    const { routes } = addToLibrary(storage, entry);
    routes.at(-1).importedAt = 1000 + i;
    writeLibrary(storage, routes);
  }
  const routes = readLibrary(storage);
  assert.equal(routes.length, MAX_ROUTES);
  assert.ok(
    routes.every((route) => route.importedAt >= 1003),
    'ce sont les plus récents qui restent'
  );
});

test('on peut retirer un parcours du dépôt', () => {
  const storage = fakeStorage();
  addToLibrary(storage, { name: 'A', loop: false, points: points(2) });
  addToLibrary(storage, { name: 'B', loop: false, points: points(2) });
  const routes = removeFromLibrary(storage, routeIdFor('A'));
  assert.equal(routes.length, 1);
  assert.equal(routes[0].id, routeIdFor('B'));
});
