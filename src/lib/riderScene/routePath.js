/*
 * routePath — l'itinéraire lu comme une abscisse curviligne.
 * ---------------------------------------------------------------------
 *
 * **Côté jeu**, comme `raceClock` : rien ici n'appartient au générateur de
 * décor. C'est la même polyligne que la carte 2D affiche déjà (la « trace
 * future », format `compact-v1`), rangée pour être interrogée par distance
 * plutôt que par index.
 *
 * Le moteur diffuse la position du coureur **et** sa distance parcourue sur
 * l'itinéraire (`lastDistanceItinerary`, en mètres, la même échelle que le `d`
 * de chaque point de la trace). Entre deux diffusions, on n'a donc pas à
 * deviner la trajectoire : il suffit de faire courir la distance et de lire où
 * elle tombe sur le tracé. Le coureur suit alors les virages au lieu de les
 * couper, et son cap est la tangente réelle de la route.
 *
 * Le tracé sert quatre lectures, et c'est tout ce qu'on lui demande :
 *
 * | Lecture | À quoi elle sert |
 * |---|---|
 * | `positionAt(d)` | où poser le coureur, et vers où l'orienter |
 * | `curvatureAt(d)` | de combien le pencher — le virage est connu **d'avance** |
 * | `gradeAt(d)` | de combien le cabrer : sur une pente, un vélo à plat s'enfonce |
 * | `projectNear(lng, lat, d)` | recaler l'abscisse sur la position diffusée |
 *
 * La projection est la pièce qui a manqué le plus longtemps : sans elle, le
 * moindre désaccord entre la position diffusée et le tracé faisait abandonner
 * l'itinéraire — alors qu'on l'avait. Voir `routeAnchor.js`.
 *
 * Module pur : pas de Vue, pas de three.js, pas d'horloge. Il ne fait que de
 * la géométrie sur des tableaux immuables.
 */

const EARTH_RADIUS_M = 6371008.8;
const DEG = Math.PI / 180;

/**
 * Fenêtre de mesure du cap, en mètres : la tangente est prise entre deux
 * points distants d'autant, centrés sur la position. Assez court pour tourner
 * dans un virage, assez long pour ignorer le bruit du tracé.
 */
export const BEARING_WINDOW_M = 12;

/**
 * Fenêtre de mesure de la courbure. Plus large que celle du cap : la courbure
 * est une dérivée seconde, et le tracé est quantifié au mètre par le serveur.
 * Trop court, on mesurerait surtout l'arrondi des coordonnées.
 */
export const CURVATURE_WINDOW_M = 26;

/** Fenêtre de mesure de la pente. Les altitudes sont au décimètre. */
export const GRADE_WINDOW_M = 40;

/**
 * Distance approchée entre deux positions, en mètres. Approximation plane
 * (équirectangulaire) : à ces échelles — quelques dizaines de mètres — l'écart
 * avec la formule sphérique est très en dessous du mètre.
 */
export function metersBetween(lngA, latA, lngB, latB) {
  const meanLat = ((latA + latB) / 2) * DEG;
  const dx = (lngB - lngA) * DEG * Math.cos(meanLat) * EARTH_RADIUS_M;
  const dy = (latB - latA) * DEG * EARTH_RADIUS_M;
  return Math.hypot(dx, dy);
}

/** Cap en degrés (0 = nord, sens horaire) du segment `a → b`. */
function bearingBetween(a, b) {
  const meanLat = ((a.lat + b.lat) / 2) * DEG;
  const east = (b.lng - a.lng) * Math.cos(meanLat);
  const north = b.lat - a.lat;
  if (east === 0 && north === 0) return null;
  const degrees = (Math.atan2(east, north) / DEG) % 360;
  return degrees < 0 ? degrees + 360 : degrees;
}

/** Écart signé le plus court entre deux caps, en degrés, dans `]-180, 180]`. */
function angleDelta(from, to) {
  let delta = (to - from) % 360;
  if (delta > 180) delta -= 360;
  if (delta <= -180) delta += 360;
  return delta;
}

/** Un itinéraire indexé par distance cumulée. Construit par `buildRoutePath`. */
export class RoutePath {
  /**
   * @param {Float64Array} lngs
   * @param {Float64Array} lats
   * @param {Float64Array} distances distances cumulées, strictement croissantes.
   * @param {Float64Array} [altitudes] mètres — `NaN` là où le serveur n'en a pas.
   */
  constructor(lngs, lats, distances, altitudes = null) {
    this.lngs = lngs;
    this.lats = lats;
    this.distances = distances;
    this.altitudes = altitudes;
  }

  get length() {
    return this.distances.length;
  }

  /** Distance cumulée du premier point. */
  get startDistance() {
    return this.distances[0];
  }

  /** Distance cumulée du dernier point. */
  get endDistance() {
    return this.distances[this.distances.length - 1];
  }

  /** Vrai si la distance tombe sur le tracé — hors tracé, on ne devine pas. */
  covers(distance) {
    return Number.isFinite(distance) && distance >= this.startDistance && distance <= this.endDistance;
  }

  /** Index du dernier point dont la distance est ≤ `distance` (recherche dichotomique). */
  _indexFor(distance) {
    const d = this.distances;
    let low = 0;
    let high = d.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (d[mid] <= distance) low = mid;
      else high = mid - 1;
    }
    return low;
  }

  /**
   * Position à cette distance, interpolée le long du segment qui la contient.
   * La distance est ramenée aux bornes du tracé.
   * @returns {{lng:number, lat:number}}
   */
  locate(distance) {
    const clamped = Math.min(Math.max(distance, this.startDistance), this.endDistance);
    const i = this._indexFor(clamped);
    const last = this.distances.length - 1;
    if (i >= last) return { lng: this.lngs[last], lat: this.lats[last] };

    const span = this.distances[i + 1] - this.distances[i];
    const t = span > 0 ? (clamped - this.distances[i]) / span : 0;
    return {
      lng: this.lngs[i] + (this.lngs[i + 1] - this.lngs[i]) * t,
      lat: this.lats[i] + (this.lats[i + 1] - this.lats[i]) * t,
    };
  }

  /**
   * Cap de la route à cette distance : la corde d'une courte fenêtre centrée
   * sur le point. Prise sur le seul segment courant, elle basculerait d'un
   * coup à chaque sommet du tracé.
   * @returns {number|null} null si la fenêtre est dégénérée (tracé d'un point).
   */
  bearingAt(distance, window = BEARING_WINDOW_M) {
    const half = window / 2;
    return bearingBetween(this.locate(distance - half), this.locate(distance + half));
  }

  /**
   * Courbure de la route à cette distance, en radians par mètre.
   *
   * **Signe : positif à droite** — le cap augmente dans le sens horaire. C'est
   * ce signe qui décide du côté vers lequel le coureur se penche, et c'est la
   * seule mesure qui le fasse *avant* le virage plutôt qu'après : le tracé est
   * connu d'avance, contrairement au lacet rendu, qui ne se mesure qu'une fois
   * le virage entamé.
   *
   * @returns {number} 0 quand la fenêtre déborde du tracé — on n'invente pas de
   *          virage aux extrémités.
   */
  curvatureAt(distance, window = CURVATURE_WINDOW_M) {
    const half = window / 2;
    if (!this.covers(distance - window) || !this.covers(distance + window)) return 0;
    const before = this.bearingAt(distance - half, half);
    const after = this.bearingAt(distance + half, half);
    if (before == null || after == null) return 0;
    return (angleDelta(before, after) * DEG) / window;
  }

  /** Altitude interpolée à cette distance, en mètres — `null` si inconnue. */
  altitudeAt(distance) {
    if (!this.altitudes) return null;
    const clamped = Math.min(Math.max(distance, this.startDistance), this.endDistance);
    const i = this._indexFor(clamped);
    const last = this.distances.length - 1;
    if (i >= last) return Number.isFinite(this.altitudes[last]) ? this.altitudes[last] : null;

    const a = this.altitudes[i];
    const b = this.altitudes[i + 1];
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    const span = this.distances[i + 1] - this.distances[i];
    const t = span > 0 ? (clamped - this.distances[i]) / span : 0;
    return a + (b - a) * t;
  }

  /**
   * Pente à cette distance, en tangente (0,08 = 8 %). Positive en montée.
   * @returns {number} 0 sans altitude exploitable.
   */
  gradeAt(distance, window = GRADE_WINDOW_M) {
    const half = window / 2;
    const low = Math.max(this.startDistance, distance - half);
    const high = Math.min(this.endDistance, distance + half);
    const span = high - low;
    if (!(span > 1)) return 0;
    const a = this.altitudeAt(low);
    const b = this.altitudeAt(high);
    if (a == null || b == null) return 0;
    return (b - a) / span;
  }

  /**
   * Position **et** cap à cette distance — ce que la scène consomme.
   * @returns {{lng:number, lat:number, bearing:number|null}}
   */
  positionAt(distance) {
    const { lng, lat } = this.locate(distance);
    return { lng, lat, bearing: this.bearingAt(distance) };
  }

  /**
   * Abscisse du point du tracé le plus proche d'une position, cherchée
   * **autour** d'une abscisse présumée.
   *
   * C'est ce qui permet de recaler la lecture sur le tracé au lieu de
   * l'abandonner : après un recalcul d'itinéraire, ou quand la position
   * diffusée et le tracé ne s'accordent pas au mètre près, la vérité est
   * toujours « le coureur est sur cette route, un peu plus loin qu'annoncé ».
   * La recherche est bornée à une fenêtre : sur un itinéraire qui repasse au
   * même endroit (aller-retour, boucle), la projection globale sauterait à
   * l'autre passage.
   *
   * @param {number} lng
   * @param {number} lat
   * @param {number} hint   abscisse présumée, en mètres.
   * @param {number} window demi-largeur de recherche, en mètres.
   * @returns {{d:number, distanceM:number}|null} null si la fenêtre est vide.
   */
  projectNear(lng, lat, hint, window = 400) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || !Number.isFinite(hint)) return null;
    const low = Math.max(this.startDistance, hint - window);
    const high = Math.min(this.endDistance, hint + window);
    if (!(high > low)) return null;

    const cosLat = Math.cos(lat * DEG);
    // Repère plan local, en mètres, centré sur le point à projeter : la
    // projection point-segment n'a de sens qu'en distances homogènes.
    const toX = (l) => (l - lng) * DEG * cosLat * EARTH_RADIUS_M;
    const toY = (l) => (l - lat) * DEG * EARTH_RADIUS_M;

    const first = this._indexFor(low);
    const lastIndex = this._indexFor(high);
    let best = null;

    for (let i = first; i <= lastIndex && i < this.distances.length - 1; i++) {
      const ax = toX(this.lngs[i]);
      const ay = toY(this.lats[i]);
      const bx = toX(this.lngs[i + 1]);
      const by = toY(this.lats[i + 1]);
      const dx = bx - ax;
      const dy = by - ay;
      const lengthSq = dx * dx + dy * dy;
      const t = lengthSq > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / lengthSq)) : 0;
      const px = ax + dx * t;
      const py = ay + dy * t;
      const distanceM = Math.hypot(px, py);
      if (best && distanceM >= best.distanceM) continue;
      best = {
        distanceM,
        d: this.distances[i] + (this.distances[i + 1] - this.distances[i]) * t,
      };
    }

    if (!best) return null;
    best.d = Math.min(Math.max(best.d, low), high);
    return best;
  }
}

/**
 * Construit un `RoutePath` depuis les points `compact-v1` de la trace future
 * (`{ c: [lng, lat], d: distance cumulée en mètres, a: altitude }`).
 *
 * Les points dont la distance recule ou stagne sont écartés : l'abscisse doit
 * être strictement croissante pour que la recherche dichotomique ait un sens,
 * et un tracé qui recule n'est de toute façon pas interpolable.
 *
 * @param {Array<{c:Array<number>, d:number, a:number}>|null} points
 * @returns {RoutePath|null} null si le tracé est inexploitable (moins de deux points).
 */
export function buildRoutePath(points) {
  if (!Array.isArray(points) || points.length < 2) return null;

  const lngs = new Float64Array(points.length);
  const lats = new Float64Array(points.length);
  const distances = new Float64Array(points.length);
  const altitudes = new Float64Array(points.length);
  let count = 0;
  let hasAltitude = false;

  for (const point of points) {
    const c = point?.c;
    if (!Array.isArray(c)) continue;
    const lng = Number(c[0]);
    const lat = Number(c[1]);
    const d = Number(point?.d);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || !Number.isFinite(d)) continue;
    if (count > 0 && d <= distances[count - 1]) continue;
    lngs[count] = lng;
    lats[count] = lat;
    distances[count] = d;
    const a = Number(point?.a);
    altitudes[count] = Number.isFinite(a) ? a : NaN;
    if (Number.isFinite(a)) hasAltitude = true;
    count++;
  }

  if (count < 2) return null;
  return new RoutePath(
    lngs.subarray(0, count),
    lats.subarray(0, count),
    distances.subarray(0, count),
    hasAltitude ? altitudes.subarray(0, count) : null
  );
}
