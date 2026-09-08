/*
 * catalog — les parcours disponibles, et comment on les charge.
 * ---------------------------------------------------------------------
 *
 * Un parcours est un fichier GPX servi en statique. Pas de base de données,
 * pas d'API : au lot 2 on en ajoute en déposant un fichier et une ligne ici.
 * Le jour où les joueurs déposeront les leurs, ce module deviendra un appel
 * réseau — et rien d'autre ne bougera, puisque tout le monde en aval ne
 * connaît qu'un `RoutePath`.
 */

import { routePointsFromGpx, buildRoutePoints } from './gpx.js';
import { buildRoutePath } from '../riderScene/routePath.js';

/**
 * @typedef {Object} RouteDescriptor
 * @property {string} id
 * @property {string} name
 * @property {string} file       chemin servi en statique.
 * @property {boolean} loop      le parcours se referme sur lui-même.
 * @property {boolean} [synthetic] tracé fabriqué, qui ne suit aucune route.
 */

/** @type {RouteDescriptor[]} */
export const ROUTES = [
  {
    id: 'boucle-demo',
    name: 'Boucle de démonstration',
    file: '/routes/boucle-demo.gpx',
    loop: true,
    synthetic: true,
  },
];

export function findRoute(id) {
  return ROUTES.find((route) => route.id === id) || ROUTES[0];
}

/**
 * Charge un parcours et en fait un tracé lisible par distance.
 *
 * @param {RouteDescriptor} descriptor
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{descriptor: RouteDescriptor, path: import('../riderScene/routePath.js').RoutePath}>}
 */
export async function loadRoute(descriptor, { signal } = {}) {
  const response = await fetch(descriptor.file, { signal });
  if (!response.ok) throw new Error(`parcours introuvable (HTTP ${response.status})`);
  const path = buildRoutePath(routePointsFromGpx(await response.text()));
  if (!path) throw new Error('parcours inexploitable');
  return { descriptor, path };
}

/**
 * Construit un tracé depuis des coordonnées brutes — celles que le dépôt de
 * parcours importés conserve (`library.js`).
 *
 * Le lissage d'altitude est appliqué **ici**, à chaque chargement, et non une
 * fois pour toutes au dépôt : c'est un réglage du moteur, et une correction de
 * ce réglage doit profiter aux parcours déjà déposés.
 *
 * @param {Array<{lng:number, lat:number, ele:number|null}>} rawPoints
 * @returns {import('../riderScene/routePath.js').RoutePath}
 */
export function pathFromRawPoints(rawPoints) {
  const path = buildRoutePath(buildRoutePoints(rawPoints));
  if (!path) throw new Error('parcours inexploitable');
  return path;
}

/**
 * Lit un fichier GPX déposé par le joueur.
 *
 * @param {File} file
 * @returns {Promise<{name: string, points: Array}>}
 */
export async function readGpxFile(file) {
  if (!file) throw new Error('aucun fichier');
  const text = await file.text();
  const points = routePointsFromGpx(text);
  // `buildRoutePoints` a déjà validé que le tracé tient debout ; on le refait
  // ici pour refuser tout de suite un fichier inexploitable, plutôt que de le
  // ranger et d'échouer au moment de rouler.
  pathFromRawPoints(points);
  const name = nameFromGpx(text) || file.name.replace(/\.gpx$/i, '');
  return { name, points };
}

const GPX_NAME = /<(?:[\w.-]+:)?name\s*>\s*([^<]{1,120}?)\s*<\//i;

/** Le nom que le fichier se donne, s'il s'en donne un. */
export function nameFromGpx(text) {
  const found = GPX_NAME.exec(String(text || ''));
  return found ? found[1].trim() : null;
}
