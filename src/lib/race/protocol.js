/*
 * protocol — ce qui circule entre deux coureurs, et comment ils se retrouvent.
 * ---------------------------------------------------------------------
 *
 * Une salle par parcours, et personne pour arbitrer : chaque client publie sa
 * position quatre fois par seconde, le serveur la recopie aux autres. C'est
 * **client-autoritaire**, donc trichable — dire qu'on roule à 90 km/h suffit.
 * C'est un choix assumé entre gens qui se connaissent, et l'interface doit le
 * dire ; ce ne serait pas acceptable pour un classement public.
 *
 * ## Ce qu'on n'envoie pas : les coordonnées
 *
 * La feuille de route prévoyait de publier `(pseudo, distance, puissance, cap)`.
 * Le cap et les coordonnées n'y sont pas, et c'est délibéré : **une salle est un
 * parcours**, donc tout le monde a déjà le tracé en mémoire. Une abscisse suffit
 * à retrouver la position, le cap et la pente de n'importe qui, au mètre près,
 * par `RoutePath.positionAt`.
 *
 * Envoyer des coordonnées coûterait davantage d'octets pour un résultat pire :
 * arrondies puis interpolées en droit, elles posent les autres coureurs à côté
 * de la chaussée dans les virages, là où l'abscisse les y garde toujours.
 *
 * ## Deux distances, et elles ne servent pas à la même chose
 *
 * | | |
 * |---|---|
 * | `d` — le compteur | tout ce qui a été parcouru : c'est lui qui classe |
 * | `r` — l'abscisse sur le tracé | toujours dans les bornes du parcours : c'est elle qui place |
 *
 * Les confondre sur un parcours qui boucle mettrait un coureur du deuxième tour
 * à trois kilomètres après l'arrivée, c'est-à-dire nulle part.
 *
 * ## Tout ce qui arrive du réseau est faux jusqu'à preuve du contraire
 *
 * Une abscisse `NaN`, un pseudo de dix mille caractères, une position à
 * l'autre bout de la Terre : rien de tout cela n'est hypothétique dès lors que
 * n'importe qui peut ouvrir une connexion. `sanitize*` borne tout ce qui entre,
 * et ce qui ne peut pas être borné est jeté. La scène 3D, elle, n'a aucune
 * défense : une coordonnée aberrante fait exploser la bulle de terrain.
 *
 * Module pur : ni réseau, ni Vue. On lui donne du texte, il rend des objets.
 */

/** Version de la trame. Deux versions différentes ne se parlent pas. */
export const PROTOCOL_VERSION = 1;

/** Rythme de publication. Quatre fois par seconde suffisent : l'interpolation
 *  fait le reste, et un peloton de dix coureurs tient alors dans un souffle. */
export const PUBLISH_INTERVAL_MS = 250;

/** Longueur maximale d'un pseudo affiché. */
export const MAX_NAME_LENGTH = 24;

/** Au-delà, la valeur est aberrante et non pas seulement surprenante. */
const MAX_DISTANCE_M = 2_000_000;
const MAX_SPEED_MS = 40; // 144 km/h : au-delà, ce n'est plus un vélo
const MAX_POWER_W = 2000;

function number(value, max, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(-max, n));
}

/**
 * Nettoie un pseudo.
 *
 * Les caractères de contrôle sont retirés plutôt qu'échappés : ils ne servent
 * à rien dans un pseudo et brouillent l'affichage — un `\r` recouvre la ligne
 * précédente dans un classement.
 */
export function sanitizeName(name, fallback = 'anonyme') {
  const cleaned = String(name ?? '')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return cleaned || fallback;
}

/**
 * L'état qu'un coureur publie. Volontairement court : ces clés partent quatre
 * fois par seconde, vers chacun.
 *
 * @param {Object} state
 * @param {number} state.distanceM   compteur, pour le classement.
 * @param {number} state.routeDistanceM abscisse sur le tracé, pour la position.
 * @param {number} state.powerW
 * @param {number} state.speedMs
 * @param {number} state.laps
 */
export function encodeState({ distanceM, routeDistanceM, powerW, speedMs, laps }) {
  return {
    t: 'at',
    // Le décimètre suffit à placer un coureur ; le reste n'est que des octets.
    d: Math.round(number(distanceM, MAX_DISTANCE_M) * 10) / 10,
    r: Math.round(number(routeDistanceM, MAX_DISTANCE_M) * 10) / 10,
    w: Math.round(number(powerW, MAX_POWER_W)),
    v: Math.round(number(speedMs, MAX_SPEED_MS) * 100) / 100,
    l: Math.max(0, Math.round(number(laps, 1000))),
  };
}

/** Borne un état reçu. `null` s'il n'a pas d'expéditeur ou pas d'abscisse. */
export function sanitizeState(message) {
  const id = message?.id == null ? null : String(message.id).slice(0, 64);
  const r = Number(message?.r);
  if (!id || !Number.isFinite(r)) return null;
  return {
    id,
    name: sanitizeName(message?.name),
    color: sanitizeColor(message?.color),
    distanceM: number(message?.d, MAX_DISTANCE_M),
    routeDistanceM: Math.min(MAX_DISTANCE_M, Math.max(0, r)),
    powerW: Math.max(0, number(message?.w, MAX_POWER_W)),
    speedMs: Math.max(0, number(message?.v, MAX_SPEED_MS)),
    laps: Math.max(0, Math.round(number(message?.l, 1000))),
  };
}

/** Une couleur n'est acceptée que sous la seule forme qu'on émet. */
export function sanitizeColor(color) {
  const value = String(color ?? '');
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : null;
}

/**
 * Lit une trame reçue. Rend `null` pour tout ce qui n'est pas exploitable —
 * un message inconnu n'est pas une erreur, c'est peut-être une version d'après.
 *
 * @param {string} raw
 * @returns {{type:string}&Object|null}
 */
export function parseMessage(raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch (e) {
    return null;
  }
  if (!message || typeof message !== 'object') return null;

  switch (message.t) {
    case 'hello': {
      const riders = Array.isArray(message.riders) ? message.riders : [];
      return {
        type: 'hello',
        id: message.id == null ? null : String(message.id).slice(0, 64),
        riders: riders.map(sanitizeState).filter(Boolean),
      };
    }
    case 'at': {
      const state = sanitizeState(message);
      return state ? { type: 'state', ...state } : null;
    }
    case 'gone': {
      const id = message.id == null ? null : String(message.id).slice(0, 64);
      return id ? { type: 'gone', id } : null;
    }
    default:
      return null;
  }
}

/**
 * Empreinte d'un parcours — l'identifiant de salle.
 *
 * Deux personnes qui importent le même GPX doivent se retrouver ensemble sans
 * s'être rien dit : l'empreinte se tire donc de la **géométrie**, jamais du nom
 * du fichier ni de l'identifiant local, qui sont propres à chaque navigateur.
 *
 * Les coordonnées sont arrondies à cinq décimales — environ un mètre — avant
 * d'entrer dans l'empreinte : deux lectures du même fichier peuvent différer
 * dans les derniers bits sans décrire deux parcours différents.
 *
 * @param {import('../riderScene/routePath.js').RoutePath} path
 * @returns {string|null} huit caractères hexadécimaux.
 */
export function routeFingerprint(path) {
  if (!path || !(path.length > 1)) return null;

  const parts = [Math.round(path.endDistance - path.startDistance)];
  // Seize points suffisent à distinguer deux parcours : deux tracés qui
  // partagent longueur et seize positions sont le même tracé.
  const samples = 16;
  for (let i = 0; i < samples; i++) {
    const d = path.startDistance + ((path.endDistance - path.startDistance) * i) / (samples - 1);
    const at = path.positionAt(d);
    if (!at) return null;
    parts.push(at.lng.toFixed(5), at.lat.toFixed(5));
  }
  return fnv1a(parts.join('|'));
}

/** FNV-1a 32 bits, rendu en hexadécimal. Pas de cryptographie ici : on veut
 *  seulement que deux parcours différents tombent rarement au même endroit. */
export function fnv1a(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Couleur stable d'un coureur, tirée de son identifiant.
 *
 * Stable et non tirée au sort : un coureur qui change de couleur entre deux
 * entrées dans la bulle n'est plus reconnaissable, alors que c'est tout ce qui
 * distingue deux silhouettes à cinquante mètres.
 */
export function colorFor(id) {
  const hue = parseInt(fnv1a(String(id ?? '')), 16) % 360;
  return hslToHex(hue, 0.62, 0.52);
}

function hslToHex(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const channel = (n) => {
    const value = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * value)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}
