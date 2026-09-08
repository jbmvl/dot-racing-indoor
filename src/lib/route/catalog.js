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

import { routePointsFromGpx } from './gpx.js';
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
