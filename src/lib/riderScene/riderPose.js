/*
 * riderPose — l'assiette du coureur : de quoi ne plus glisser sous la route.
 * ---------------------------------------------------------------------
 *
 * Jusqu'ici le coureur n'avait qu'un lacet : une rotation autour de la
 * verticale, posée sur un point du sol. Trois choses manquaient, et les trois
 * se voient.
 *
 * 1. **Le lacet ne venait pas de la trajectoire.** Il interpolait les caps
 *    moyens du moteur pendant que la position, elle, suivait une autre courbe.
 *    Un vélo qui n'est pas orienté selon son déplacement donne exactement
 *    l'impression de glisser sous la route. Ici le lacet est **la tangente du
 *    tracé**, donc la direction du déplacement par construction.
 *
 * 2. **L'assiette.** Un vélo rendu à plat sur une côte à 8 % s'enfonce dans le
 *    bitume par l'avant. Le tangage se prend sur le sol effectivement rendu,
 *    devant et derrière la roue, et le roulis de contact sur la largeur — le
 *    dévers.
 *
 * 3. **L'inclinaison en virage.** Elle existait, mais du mauvais côté, et
 *    mesurée sur le lacet **déjà rendu et déjà lissé** : elle arrivait donc
 *    après le virage, et valait deux ou trois degrés. Ici elle se calcule sur
 *    la courbure du tracé, connue *d'avance*.
 *
 * ## La loi d'inclinaison
 *
 * La physique donne `φ = atan(v²κ/g)` : juste, mais illisible à vélo de course
 * — quinze degrés dans un virage qu'on prend à fond, deux degrés en ville. On
 * garde donc la physique pour dire **quand** pencher, et la vitesse pour dire
 * **de combien** :
 *
 *     amplitude(v) = 5° à 20 km/h … 35° à 50 km/h
 *     inclinaison  = signe(κ) · amplitude(v) · tanh(φ / φref)
 *
 * En ligne droite `φ = 0` : le coureur est droit, quelle que soit sa vitesse.
 * Dans un virage franc il atteint l'amplitude de sa vitesse. Entre les deux, la
 * tangente hyperbolique donne une montée douce et une saturation propre — pas
 * de seuil, pas de claquement.
 *
 * **Signe.** `κ > 0` = la route tourne à droite = le coureur penche à droite.
 * Dans le repère du modèle, `-z` est l'avant et `+x` la droite : une rotation
 * positive autour de `z` couche le haut du corps vers `-x`, c'est-à-dire vers
 * la **gauche**. La rotation appliquée est donc `-inclinaison`. L'ancien code
 * appliquait l'inverse, et le coureur se couchait vers l'extérieur du virage.
 *
 * Module pur : ni three.js, ni Vue. L'appelant fournit le temps écoulé.
 */

const DEG = Math.PI / 180;
const GRAVITY = 9.81;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const clamp01 = (value) => clamp(value, 0, 1);

export const LEAN = {
  /** Vitesses de référence de l'amplitude : 20 km/h et 50 km/h. */
  lowSpeedMs: 20 / 3.6,
  highSpeedMs: 50 / 3.6,
  /** Amplitudes correspondantes. */
  lowLeanRad: 5 * DEG,
  highLeanRad: 35 * DEG,
  /**
   * Inclinaison physique à laquelle un virage compte pour « franc ». Six
   * degrés, c'est un rayon de 60 m pris à 30 km/h : le tout-venant d'un
   * parcours de course. En dessous, le coureur reste presque droit ; au-dessus,
   * il atteint l'amplitude de sa vitesse.
   */
  referenceRad: 6 * DEG,
  /** En dessous, on ne penche plus : à l'arrêt, un vélo est droit. */
  minSpeedMs: 1.2,
};

/**
 * Inclinaison visée, en radians. **Positif = penché à droite.**
 *
 * @param {number} speedMs   vitesse rendue, en m/s.
 * @param {number} curvature courbure du tracé, en rad/m, positive à droite.
 * @returns {number}
 */
export function leanFor(speedMs, curvature) {
  const v = Number(speedMs) || 0;
  const k = Number(curvature) || 0;
  if (v < LEAN.minSpeedMs || k === 0) return 0;

  const lateral = v * v * k;
  const physical = Math.atan(Math.abs(lateral) / GRAVITY);
  const amplitude =
    LEAN.lowLeanRad +
    (LEAN.highLeanRad - LEAN.lowLeanRad) *
      clamp01((v - LEAN.lowSpeedMs) / (LEAN.highSpeedMs - LEAN.lowSpeedMs));

  return Math.sign(lateral) * amplitude * Math.tanh(physical / LEAN.referenceRad);
}

export const POSE_DEFAULTS = {
  /** Réponse de l'inclinaison. 0,30 s : le corps suit le virage sans flotter. */
  leanTauS: 0.3,
  /** Réponse de l'assiette. Plus lente : le relief est bruité à la maille. */
  attitudeTauS: 0.22,
  /** Bornes d'assiette : au-delà, c'est le terrain qui ment, pas le coureur. */
  maxPitchRad: 25 * DEG,
  maxRollRad: 12 * DEG,
  /**
   * Avance de lecture de la courbure, en secondes. Un cycliste s'incline en
   * entrant dans le virage, pas au milieu.
   */
  lookAheadS: 0.45,
  /** Plafond de l'avance, en mètres : inutile de viser au-delà du virage. */
  maxLookAheadM: 22,
};

/**
 * L'assiette rendue, filtrée.
 *
 * Trois angles, trois régimes : l'inclinaison a un ressort du second ordre à
 * amortissement critique — elle doit *s'engager*, pas ramper —, le tangage et
 * le roulis de contact ont un simple filtre exponentiel, parce qu'ils suivent
 * un sol dont on ne veut que la tendance.
 */
export function createRiderPose(options = {}) {
  const config = { ...POSE_DEFAULTS, ...options };
  let lean = 0;
  let leanRate = 0;
  let pitch = 0;
  let roll = 0;

  return {
    get lean() {
      return lean;
    },
    get pitch() {
      return pitch;
    },
    get roll() {
      return roll;
    },

    /** Distance de lecture anticipée de la courbure, à cette vitesse. */
    lookAheadFor(speedMs) {
      return Math.min(config.maxLookAheadM, Math.max(0, (Number(speedMs) || 0) * config.lookAheadS));
    },

    /** Pose l'assiette sans transition (montage, changement de coureur). */
    seat({ lean: l = 0, pitch: p = 0, roll: r = 0 } = {}) {
      lean = l;
      leanRate = 0;
      pitch = p;
      roll = r;
    },

    /**
     * @param {number} deltaS secondes écoulées.
     * @param {Object} target
     * @param {number} target.speed     vitesse rendue, en m/s.
     * @param {number} target.curvature courbure du tracé, en rad/m (+ à droite).
     * @param {number} target.pitch     tangage mesuré sur le sol rendu, en radians.
     * @param {number} target.roll      dévers mesuré sur le sol rendu, en radians.
     * @returns {{lean:number, pitch:number, roll:number}}
     */
    update(deltaS, { speed = 0, curvature = 0, pitch: groundPitch = 0, roll: groundRoll = 0 } = {}) {
      if (!(deltaS > 0)) return { lean, pitch, roll };

      const wanted = leanFor(speed, curvature);
      const omega = 2 / config.leanTauS;
      leanRate += (omega * omega * (wanted - lean) - 2 * omega * leanRate) * deltaS;
      lean += leanRate * deltaS;

      const k = 1 - Math.exp(-deltaS / config.attitudeTauS);
      const wantedPitch = clamp(Number(groundPitch) || 0, -config.maxPitchRad, config.maxPitchRad);
      const wantedRoll = clamp(Number(groundRoll) || 0, -config.maxRollRad, config.maxRollRad);
      pitch += (wantedPitch - pitch) * k;
      roll += (wantedRoll - roll) * k;

      return { lean, pitch, roll };
    },
  };
}

/**
 * Tangage et dévers, lus sur quatre points du sol **effectivement rendu**.
 *
 * On ne prend ni la pente de l'itinéraire ni celle du terrain nu : la chaussée
 * est entaillée dans le relief par le générateur de décor, et c'est sur elle
 * que roulent les roues. Un tangage calculé ailleurs que là où le vélo pose
 * ferait flotter la roue avant sur toute route en déblai.
 *
 * @param {Object} ground
 * @param {{y:number}} ground.front point du sol devant la roue avant.
 * @param {{y:number}} ground.rear  derrière la roue arrière.
 * @param {{y:number}} ground.left
 * @param {{y:number}} ground.right
 * @param {number} ground.spanM     écartement avant/arrière, en mètres.
 * @param {number} ground.widthM    écartement gauche/droite, en mètres.
 * @returns {{pitch:number, roll:number}} radians. Tangage positif en montée.
 *          Roulis dans la **même convention que l'inclinaison** : positif quand
 *          le vélo est couché vers la droite — donc quand le bas-côté gauche
 *          est le plus haut. Les deux angles s'appliquent alors de la même
 *          façon, et on ne peut plus se tromper de côté sur l'un des deux.
 */
export function attitudeFromGround({ front, rear, left, right, spanM, widthM }) {
  const pitch =
    front && rear && spanM > 0 ? Math.atan2(front.y - rear.y, spanM) : 0;
  const roll =
    left && right && widthM > 0 ? Math.atan2(left.y - right.y, widthM) : 0;
  return { pitch, roll };
}
