/*
 * lobby — le salon vu du client : l'adresse, et ce qu'on croit de ce qui revient.
 * ---------------------------------------------------------------------
 *
 * Le salon répond à la question que l'empreinte de parcours laissait sans
 * réponse. Une salle **est** un tracé (cf. `protocol.js`) : deux personnes qui
 * ont le même GPX s'y retrouvent sans s'être rien dit — mais tant qu'elles ne
 * l'ont pas échangé, elles ne peuvent ni se voir ni se rejoindre. Le salon
 * liste les salles ouvertes et transporte leur tracé.
 *
 * ## Le format qui circule est celui du dépôt, et ce n'est pas un hasard
 *
 * Un tracé part et revient sous la forme que `library.packPoints` produit : un
 * tableau plat de triplets `lng, lat, ele`. Ce n'est pas un troisième format
 * qui s'ajouterait aux deux qui ont déjà coûté une panne d'import (cf.
 * `CLAUDE.md`) — c'est la sérialisation du **brut**, celle que `localStorage`
 * range déjà, et elle ne sort jamais d'ici : `roomPoints` rend du brut,
 * `roomBody` prend du brut.
 *
 * Il fallait que ce soit exactement celle-là. Celui qui importe un GPX ne roule
 * pas sur les coordonnées du fichier mais sur celles que son dépôt a retenues,
 * arrondies au millionième de degré (`useRouteLibrary.resolve`). Transmettre
 * les coordonnées d'origine ferait tomber l'invité sur une empreinte voisine
 * mais différente — deux salles au lieu d'une, et personne ne comprendrait
 * pourquoi. En transmettant ce que le dépôt garde, les deux empreintes sont la
 * même par construction.
 *
 * ## Tout ce qui arrive du salon est faux jusqu'à preuve du contraire
 *
 * Même doctrine que `protocol.js`, et pour une raison plus grave ici : une
 * position aberrante fait un coureur mal placé, un **tracé** aberrant fait
 * exploser la bulle de terrain de celui qui le charge. Ce qui ne peut pas être
 * borné est jeté en bloc.
 *
 * Module pur : ni réseau, ni Vue. La liaison est dans `useLobby`.
 */

import { MAX_NAME_LENGTH, sanitizeName } from './protocol.js';
import { packPoints, unpackPoints } from '../route/library.js';

/** Un nom de parcours est plus long qu'un pseudo — `library` en garde 120. */
const MAX_ROUTE_NAME = 120;
/** Ce que l'écran d'accueil peut montrer sans devenir un catalogue. */
const MAX_ROOMS_SHOWN = 40;
/** Au-delà, la valeur est aberrante et non pas seulement surprenante. */
const MAX_DISTANCE_M = 2_000_000;

function text(value, max, fallback) {
  const cleaned = String(value ?? '')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .trim()
    .slice(0, max);
  return cleaned || fallback;
}

/**
 * L'adresse du salon, tirée de celle du serveur de salles.
 *
 * `useRoom` tient cette adresse en `ws://`, parce que c'est ce dont une
 * WebSocket a besoin ; le salon, lui, se lit en HTTP. Le même hôte, deux
 * protocoles — d'où cette conversion plutôt qu'une seconde variable
 * d'environnement à tenir en accord avec la première.
 *
 * @param {string|null} base adresse `ws://` ou `wss://`.
 * @param {string} [path] suffixe, `/<empreinte>` ou rien.
 * @returns {string|null}
 */
export function lobbyUrl(base, path = '') {
  if (!base) return null;
  const host = String(base)
    .trim()
    .replace(/\/+$/, '')
    .replace(/^ws/, 'http');
  return `${host}/lobby${path}`;
}

/**
 * Borne une salle annoncée. `null` si elle n'a pas d'identifiant exploitable —
 * sans lui, il n'y a rien à rejoindre.
 */
export function sanitizeRoom(entry) {
  const id = entry?.id == null ? null : String(entry.id).slice(0, 64);
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
  const distanceM = Number(entry?.distanceM);
  return {
    id,
    host: sanitizeName(entry?.host),
    name: text(entry?.name, MAX_ROUTE_NAME, 'Parcours'),
    distanceM: Number.isFinite(distanceM) ? Math.max(0, Math.min(MAX_DISTANCE_M, distanceM)) : 0,
  };
}

/** Borne la liste entière. Une salle illisible est retirée, pas fatale. */
export function sanitizeRoomList(payload) {
  const rooms = Array.isArray(payload?.rooms) ? payload.rooms : [];
  return rooms.map(sanitizeRoom).filter(Boolean).slice(0, MAX_ROOMS_SHOWN);
}

/**
 * Le tracé d'une salle, rendu en points **bruts**.
 *
 * `unpackPoints` jette déjà ce qui n'est pas un nombre, mais il ne juge pas des
 * valeurs : une latitude de 4000 le traverserait intacte. Elle est écartée ici,
 * parce que la scène qui recevrait ce point n'a aucun moyen de s'en défendre.
 *
 * @returns {Array<{lng:number, lat:number, ele:number|null}>|null}
 */
export function roomPoints(payload) {
  const points = unpackPoints(payload?.coords).filter(
    (point) => point.lng >= -180 && point.lng <= 180 && point.lat >= -90 && point.lat <= 90
  );
  // Un point isolé n'est pas un tracé : `buildRoutePath` n'en ferait rien.
  return points.length > 1 ? points : null;
}

/**
 * Le corps d'une annonce.
 *
 * Sans `points`, c'est un simple rafraîchissement : le tracé ne part qu'à
 * l'ouverture, et le salon le garde. Le renvoyer deux fois par minute
 * téléverserait le GPX entier pour ne rien apprendre à personne.
 *
 * @param {Object} room
 * @param {Array<{lng:number, lat:number, ele:number|null}>} [room.points] points bruts.
 */
export function roomBody({ host, name, distanceM, points = null }) {
  const body = {
    host: text(host, MAX_NAME_LENGTH, 'anonyme'),
    name: text(name, MAX_ROUTE_NAME, 'Parcours'),
    distanceM: Math.max(0, Math.min(MAX_DISTANCE_M, Number(distanceM) || 0)),
  };
  if (points) body.coords = packPoints(points);
  return body;
}
