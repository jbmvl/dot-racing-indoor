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

import { parseGpxTrackPoints, buildRoutePoints } from './gpx.js';
import { buildRoutePath } from '../riderScene/routePath.js';

/**
 * @typedef {Object} RouteDescriptor
 * @property {string} id
 * @property {string} name
 * @property {string} file       chemin servi en statique.
 * @property {boolean} loop      le parcours se referme sur lui-même.
 */

/**
 * Les parcours livrés avec l'application.
 *
 * Vide pour l'instant, et ce n'est pas un oubli : le parcours de démonstration
 * qui l'occupait était un cercle synthétique qui ne suivait aucune route, et il
 * a fait son office. Y remettre de vrais tracés demande de régler la question
 * des droits — une trace publiée par un club ou un site de parcours ne se
 * redistribue pas dans un dépôt public par défaut.
 *
 * En attendant, tout passe par l'import : le joueur dépose son propre GPX, qui
 * reste dans son navigateur.
 *
 * @type {RouteDescriptor[]}
 */
export const ROUTES = [];

export function findRoute(id) {
  return ROUTES.find((route) => route.id === id) || ROUTES[0] || null;
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
  const path = pathFromRawPoints(parseGpxTrackPoints(await response.text()));
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
 * Rend les points **bruts** (`{lng, lat, ele}`), et c'est la seule forme qui
 * circule ici : c'est celle que `library.packPoints` range, et celle que
 * `pathFromRawPoints` sait lire. Le format « compact » (`{c, d, a}`) est un
 * détail interne de `buildRoutePath`, produit au dernier moment et jamais
 * stocké — le lissage d'altitude qu'il porte est un réglage du moteur, pas une
 * propriété du fichier.
 *
 * @param {File} file
 * @returns {Promise<{name: string, points: Array<{lng:number, lat:number, ele:number|null}>}>}
 */
export async function readGpxFile(file) {
  if (!file) throw new Error('aucun fichier');
  const text = await file.text();
  let points;
  try {
    points = parseGpxTrackPoints(text);
    // On construit le tracé tout de suite, pour refuser un fichier
    // inexploitable maintenant plutôt qu'au moment de rouler. Le résultat est
    // jeté : c'est une validation, pas un cache.
    pathFromRawPoints(points);
  } catch (e) {
    // Le nom du fichier est ce que le joueur a sous les yeux : le citer évite
    // le « ça ne marche pas » sans savoir lequel des trois fichiers déposés a
    // été refusé.
    throw new Error(`« ${file.name} » n’est pas un GPX lisible (${e.message})`);
  }
  const name = nameFromGpx(text) || file.name.replace(/\.gpx$/i, '');
  return { name, points };
}

const GPX_NAME = /<(?:[\w.-]+:)?name\s*>\s*([^<]{1,120}?)\s*<\//i;

/** Le nom que le fichier se donne, s'il s'en donne un. */
export function nameFromGpx(text) {
  const found = GPX_NAME.exec(String(text || ''));
  return found ? found[1].trim() : null;
}
