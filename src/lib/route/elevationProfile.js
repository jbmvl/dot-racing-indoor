/*
 * elevationProfile — le parcours vu de profil.
 * ---------------------------------------------------------------------
 *
 * Deux services distincts, et les confondre est l'erreur classique :
 *
 * | | |
 * |---|---|
 * | `profileStats(path)`   | le dénivelé, lu sur **tous** les points |
 * | `sampleProfile(path)`  | une poignée de points, pour **dessiner** |
 *
 * Un graphique de 300 pixels de large n'a pas besoin des 40 000 points d'un
 * GPX ; mais le dénivelé, lui, doit être compté sur tous, sans quoi il fond.
 * Échantillonner d'abord et sommer ensuite sous-estime le D+ d'autant plus que
 * l'échantillonnage est grossier — c'est le genre de chiffre faux qu'on ne
 * remarque pas, parce qu'il reste plausible.
 *
 * ## Pourquoi le dénivelé se lit sur les altitudes lissées
 *
 * Les altitudes portées par un `RoutePath` sont déjà passées par la moyenne
 * glissante de `gpx.js`, et c'est délibéré : sommer les montées d'un relevé
 * brut compte le bruit du GPS comme du dénivelé, et gonfle un D+ de plusieurs
 * dizaines de pour cent. Toutes les montres le font, et tout le monde s'en
 * plaint. On compte donc sur le signal lissé — le même que celui qui décide de
 * la pente, donc de l'effort.
 *
 * Module pur : pas de Vue, pas de Chart.js, pas de DOM.
 */

/** Nombre de points tracés par défaut : au-delà, l'écran ne distingue plus. */
export const DEFAULT_SAMPLES = 320;

/**
 * Dénivelé positif et négatif, altitudes extrêmes.
 *
 * Les points sans altitude connue sont sautés sans rompre le compte : on
 * compare le dernier point connu au suivant, ce qui vaut mieux que de repartir
 * à zéro de part et d'autre d'un trou.
 *
 * @param {import('../riderScene/routePath.js').RoutePath} path
 * @returns {{ascentM:number, descentM:number, minM:number|null, maxM:number|null, hasElevation:boolean}}
 */
export function profileStats(path) {
  const altitudes = path?.altitudes;
  const empty = { ascentM: 0, descentM: 0, minM: null, maxM: null, hasElevation: false };
  if (!altitudes || altitudes.length === 0) return empty;

  let ascent = 0;
  let descent = 0;
  let min = Infinity;
  let max = -Infinity;
  let previous = null;

  for (let i = 0; i < altitudes.length; i++) {
    const value = altitudes[i];
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
    if (previous != null) {
      const delta = value - previous;
      if (delta > 0) ascent += delta;
      else descent -= delta;
    }
    previous = value;
  }

  if (previous == null) return empty;
  return {
    ascentM: ascent,
    descentM: descent,
    minM: min,
    maxM: max,
    hasElevation: true,
  };
}

/**
 * Échantillonne le profil à pas constant, pour le tracé.
 *
 * Le pas est **une distance**, pas un nombre de points d'origine : un GPX dense
 * et un GPX clairsemé du même parcours donnent la même courbe. Les extrémités
 * sont toujours incluses, sans quoi la courbe s'arrêterait avant la fin.
 *
 * @param {import('../riderScene/routePath.js').RoutePath} path
 * @param {Object} [options]
 * @param {number} [options.samples] nombre de points visés (minimum 2).
 * @returns {Array<{x:number, y:number}>} `x` en kilomètres, `y` en mètres.
 *          Vide si le parcours ne porte aucune altitude.
 */
export function sampleProfile(path, { samples = DEFAULT_SAMPLES } = {}) {
  if (!path || path.length < 2) return [];
  const start = path.startDistance;
  const end = path.endDistance;
  const span = end - start;
  if (!(span > 0)) return [];

  const count = Math.max(2, Math.floor(samples));
  const step = span / (count - 1);
  const points = [];

  for (let i = 0; i < count; i++) {
    // Le dernier point est posé sur la borne plutôt que calculé : l'accumulation
    // de `step` finirait sinon quelques centimètres avant la fin, et la courbe
    // s'arrêterait visiblement trop tôt sur un parcours long.
    const distance = i === count - 1 ? end : start + i * step;
    const altitude = path.altitudeAt(distance);
    if (altitude == null) continue;
    points.push({ x: (distance - start) / 1000, y: altitude });
  }

  // Une courbe d'un seul point ne se trace pas : mieux vaut dire qu'il n'y a
  // pas de profil que d'en afficher un faux.
  return points.length >= 2 ? points : [];
}

/**
 * Tout ce qu'il faut pour afficher un profil, en un appel.
 *
 * @param {import('../riderScene/routePath.js').RoutePath} path
 * @param {Object} [options] passées à `sampleProfile`.
 */
export function buildProfile(path, options) {
  const points = sampleProfile(path, options);
  const stats = profileStats(path);
  return {
    points,
    ...stats,
    lengthM: path && path.length >= 2 ? path.endDistance - path.startDistance : 0,
    hasElevation: stats.hasElevation && points.length >= 2,
  };
}
