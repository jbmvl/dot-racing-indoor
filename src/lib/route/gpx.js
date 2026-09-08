/*
 * gpx — un fichier de trace devient un parcours lisible par distance.
 * ---------------------------------------------------------------------
 *
 * Le tracé est la seule chose que la séance connaisse du terrain : c'est lui
 * qui dit où l'on est, vers où l'on regarde, et **quelle pente on grimpe**. La
 * pente est ici la valeur sensible : elle entre directement dans le calcul de
 * la vitesse, donc dans ce que les jambes ressentent.
 *
 * D'où la décision qui structure ce module : **l'altitude est lissée, jamais
 * brute.** Un relevé GPS barométrique bruite l'altitude de quelques dizaines
 * de centimètres d'un point au suivant ; sur des points espacés de dix mètres,
 * cela fabrique des pentes de ±5 % qui n'existent pas, et la vitesse calculée
 * oscillerait au rythme du bruit. On moyenne donc sur une fenêtre de plusieurs
 * dizaines de mètres — assez large pour noyer le bruit, assez courte pour
 * garder un raidillon.
 *
 * Le format de sortie est celui que `routePath.buildRoutePath` attend
 * (`compact-v1` : `{ c: [lng, lat], d, a }`), et ce n'est pas un hasard — c'est
 * ce qui permet de reprendre `routePath.js` sans y toucher une ligne.
 *
 * Module pur : pas de DOM, pas de réseau. La lecture du XML se fait à la
 * regexp plutôt qu'au `DOMParser`, pour deux raisons : le sous-ensemble de GPX
 * qui nous intéresse (`<trkpt lat lon>` et son `<ele>`) est trivialement
 * régulier, et un module sans DOM se teste sous `node --test` sans navigateur.
 * Contrepartie assumée : un GPX exotique (espaces de noms inhabituels,
 * attributs dans un autre ordre) n'est pas lu. On lève alors plutôt que de
 * rendre un tracé partiel.
 */

import { metersBetween } from '../riderScene/routePath.js';

/** Demi-fenêtre de lissage de l'altitude, en mètres. */
export const ALTITUDE_WINDOW_M = 50;

/*
 * Les motifs de lecture. Trois précautions, chacune payée par un fichier réel
 * qui, sans elle, ne se lit pas :
 *
 * 1. **`lat` et `lon` dans n'importe quel ordre.** Rien dans GPX n'impose que
 *    `lat` vienne avant `lon`, et les exportateurs se partagent les deux
 *    usages. Les attributs sont donc cherchés séparément, jamais dans une
 *    séquence figée.
 * 2. **Un préfixe d'espace de noms possible** (`<gpx:trkpt>`), que certains
 *    outils émettent.
 * 3. **`rtept` autant que `trkpt`.** Un site de parcours exporte volontiers un
 *    *itinéraire* (`<rte>`) plutôt qu'une *trace* (`<trk>`). Les deux décrivent
 *    une polyligne ; seule la densité de points change.
 */
const POINT_OPEN = (kind) => new RegExp(`<(?:[\\w.-]+:)?${kind}\\b([^>]*)>`, 'gi');
const LAT_ATTR = /\blat\s*=\s*["']([^"']+)["']/i;
const LON_ATTR = /\blon\s*=\s*["']([^"']+)["']/i;
const ELE_TAG = /<(?:[\w.-]+:)?ele\s*>\s*(-?[\d.]+(?:[eE][+-]?\d+)?)\s*</i;

/**
 * Balaie un type de point (`trkpt` ou `rtept`) et rend ce qui est exploitable.
 *
 * Le corps d'un point va de sa balise ouvrante jusqu'à l'ouverture du suivant :
 * c'est ce qui permet de lire son `<ele>` sans avoir à distinguer la forme
 * fermée `<trkpt …>…</trkpt>` de la forme auto-fermante `<trkpt … />`, et sans
 * dépendre d'un `</trkpt>` que certains fichiers indentent bizarrement.
 *
 * @returns {Array<{lng:number, lat:number, ele:number|null}>}
 */
function scanPoints(text, kind) {
  const opens = [];
  const pattern = POINT_OPEN(kind);
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    opens.push({ attrs: m[1], bodyStart: m.index + m[0].length });
  }

  const points = [];
  for (let i = 0; i < opens.length; i++) {
    const { attrs, bodyStart } = opens[i];
    const lat = Number(LAT_ATTR.exec(attrs)?.[1]);
    const lng = Number(LON_ATTR.exec(attrs)?.[1]);
    // Un point sans coordonnée lisible, ou hors du monde, est écarté : il n'y a
    // rien à en tirer, et le deviner serait pire que de l'ignorer.
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;

    const bodyEnd = i + 1 < opens.length ? opens[i + 1].bodyStart : text.length;
    const ele = Number(ELE_TAG.exec(text.slice(bodyStart, bodyEnd))?.[1]);
    points.push({ lng, lat, ele: Number.isFinite(ele) ? ele : null });
  }
  return points;
}

/**
 * Extrait les points de trace d'un GPX.
 *
 * @param {string} text contenu du fichier.
 * @returns {Array<{lng:number, lat:number, ele:number|null}>}
 * @throws {Error} si aucun point exploitable n'est trouvé.
 */
export function parseGpxTrackPoints(text) {
  if (typeof text !== 'string' || text.trim().length === 0) throw new Error('GPX vide');

  /*
   * La trace prime sur l'itinéraire quand le fichier porte les deux. Un `<trk>`
   * est une polyligne dense — le relevé, ou le calage sur les routes ; un
   * `<rte>` n'est souvent qu'une poignée de points de passage. Les mélanger
   * donnerait un tracé qui coupe à travers champs entre deux virages.
   */
  const track = scanPoints(text, 'trkpt');
  const points = track.length >= 2 ? track : scanPoints(text, 'rtept');

  if (points.length < 2) throw new Error('GPX sans trace exploitable (moins de deux points)');
  return points;
}

/**
 * Moyenne glissante des altitudes sur une fenêtre exprimée en **mètres le long
 * du tracé**, et non en nombre de points : un GPX dense et un GPX clairsemé
 * doivent donner la même pente.
 *
 * Les points sans altitude sont ignorés dans la moyenne mais gardent leur
 * place ; si aucun point de la fenêtre n'en a, le résultat est `NaN` et le
 * calcul de pente s'abstiendra plus loin.
 *
 * @param {Array<{ele:number|null}>} points
 * @param {Float64Array|number[]} distances distances cumulées, croissantes.
 * @param {number} [windowM] demi-fenêtre.
 * @returns {Float64Array} altitudes lissées, `NaN` là où l'on ne sait pas.
 */
export function smoothAltitudes(points, distances, windowM = ALTITUDE_WINDOW_M) {
  const n = points.length;
  const out = new Float64Array(n);
  let low = 0;
  let high = 0;
  let sum = 0;
  let count = 0;

  for (let i = 0; i < n; i++) {
    const from = distances[i] - windowM;
    const to = distances[i] + windowM;

    // La fenêtre ne recule jamais : chaque borne avance au plus une fois par
    // point, ce qui garde le lissage linéaire même sur un tracé de 100 000
    // points.
    while (high < n && distances[high] <= to) {
      const e = points[high].ele;
      if (e != null) {
        sum += e;
        count++;
      }
      high++;
    }
    while (low < n && distances[low] < from) {
      const e = points[low].ele;
      if (e != null) {
        sum -= e;
        count--;
      }
      low++;
    }

    out[i] = count > 0 ? sum / count : NaN;
  }

  return out;
}

/**
 * Assemble les points `compact-v1` que `buildRoutePath` consomme.
 *
 * Les points strictement confondus sont écartés : l'abscisse doit croître pour
 * que la recherche dichotomique de `RoutePath` ait un sens, et deux points au
 * même endroit ne portent aucune information de cap.
 *
 * @param {Array<{lng:number, lat:number, ele:number|null}>} raw
 * @param {Object} [options]
 * @param {number} [options.altitudeWindowM]
 * @param {number} [options.minSpacingM] écart minimal entre deux points gardés.
 * @returns {Array<{c:[number,number], d:number, a:number}>}
 */
export function buildRoutePoints(raw, { altitudeWindowM = ALTITUDE_WINDOW_M, minSpacingM = 0.5 } = {}) {
  const kept = [];
  const distances = [];
  let travelled = 0;

  for (let i = 0; i < raw.length; i++) {
    const point = raw[i];
    if (kept.length > 0) {
      const previous = kept[kept.length - 1];
      const step = metersBetween(previous.lng, previous.lat, point.lng, point.lat);
      if (step < minSpacingM) continue;
      travelled += step;
    }
    kept.push(point);
    distances.push(travelled);
  }

  if (kept.length < 2) throw new Error('tracé inexploitable après nettoyage');

  const altitudes = smoothAltitudes(kept, distances, altitudeWindowM);
  return kept.map((point, i) => ({
    c: [point.lng, point.lat],
    d: distances[i],
    a: altitudes[i],
  }));
}

/**
 * Chaîne complète : texte GPX → points `compact-v1`.
 *
 * @param {string} text
 * @param {Object} [options] passées à `buildRoutePoints`.
 */
export function routePointsFromGpx(text, options) {
  return buildRoutePoints(parseGpxTrackPoints(text), options);
}
