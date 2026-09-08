/*
 * La vitesse et le lacet d'un coureur, mesurés sur ce qui est **rendu**.
 *
 * Réservé à la **foule** : le coureur suivi, lui, tient sa vitesse de son
 * horloge (`raceClock`), qui la connaît exactement. Les autres coureurs n'ont ni
 * tracé ni courbure — l'API réserve l'itinéraire à son propriétaire —, donc leur
 * vitesse et leur lacet ne peuvent se lire que sur leur déplacement à l'écran.
 * C'est de toute façon ce défilement-là que l'œil compare au pédalage.
 *
 * Le filtre n'est pas un raffinement : la dérivée brute saute à chaque
 * échantillon, ce qui ferait accélérer et ralentir les jambes à chaque
 * diffusion.
 */

const TWO_PI = Math.PI * 2;

/** Écart signé le plus court entre deux angles en radians, dans `]-π, π]`. */
export function shortestRadianDelta(from, to) {
  let delta = (to - from) % TWO_PI;
  if (delta > Math.PI) delta -= TWO_PI;
  if (delta <= -Math.PI) delta += TWO_PI;
  return delta;
}

/**
 * @param {Object} [options]
 * @param {number} [options.smoothing] Vitesse du filtre, en s⁻¹.
 * @param {number} [options.maxSpeed]  Au-delà, le déplacement est un saut de
 *        rattrapage et non une vitesse : la position a été reposée d'un bloc.
 */
export function createMotionMeter({ smoothing = 3, maxSpeed = 40 } = {}) {
  const state = { speed: 0, turn: 0 };
  let lastX = null;
  let lastZ = null;
  let lastYaw = 0;

  return {
    state,

    /** Oublie le déplacement précédent (montage, saut, changement de coureur). */
    reset() {
      lastX = null;
      lastZ = null;
      state.speed = 0;
      state.turn = 0;
    },

    /**
     * @param {number} x Repère de la scène, en mètres.
     * @param {number} z
     * @param {number} yaw Cap rendu, en radians.
     * @param {number} delta Secondes écoulées.
     * @returns {{speed:number, turn:number}} en m/s et rad/s.
     */
    measure(x, z, yaw, delta) {
      if (!(delta > 0)) return state;

      if (lastX != null) {
        const rawSpeed = Math.hypot(x - lastX, z - lastZ) / delta;
        const speed = rawSpeed > maxSpeed ? state.speed : rawSpeed;
        const turn = shortestRadianDelta(lastYaw, yaw) / delta;
        const k = 1 - Math.exp(-smoothing * delta);
        state.speed += (speed - state.speed) * k;
        state.turn += (turn - state.turn) * k;
      }

      lastX = x;
      lastZ = z;
      lastYaw = yaw;
      return state;
    },
  };
}
