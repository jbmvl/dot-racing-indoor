/*
 * useRide — la séance : le parcours, la vitesse, et ce que le tableau de bord
 * en montre.
 * ---------------------------------------------------------------------
 *
 * Une seule règle de structure, et elle explique la forme du fichier :
 * **l'état de séance n'est pas réactif, seuls les compteurs le sont.** Les
 * valeurs changent soixante fois par seconde ; les faire passer par la
 * réactivité de Vue à ce rythme coûterait plus cher que le rendu 3D lui-même.
 * `rideState` vit donc dans une variable de fermeture, et un `publish()` appelé
 * quelques fois par seconde recopie ce que l'interface a besoin de lire.
 *
 * Le pilote de vitesse est provisoire : au clavier, on impose une vitesse.
 * C'est le lot 1. Au lot 3, cette fonction est remplacée par le modèle
 * physique (puissance, masse, pente, air), et au lot 4 la puissance vient du
 * home-trainer. Rien d'autre ne bougera : `rideState.advance(delta, vitesse)`
 * ne sait pas d'où vient la vitesse, et c'est exactement pour cela qu'il a été
 * écrit comme ça.
 */

import { ref, shallowRef, onBeforeUnmount } from 'vue';
import { createRideState } from '@/lib/ride/rideState.js';
import { loadRoute, findRoute } from '@/lib/route/catalog.js';

/** Vitesse de départ et bornes du pilote clavier, en km/h. */
export const KEYBOARD_START_KMH = 28;
export const KEYBOARD_MIN_KMH = 0;
export const KEYBOARD_MAX_KMH = 75;
export const KEYBOARD_STEP_KMH = 2;

/** Le tableau de bord n'a pas besoin de soixante rafraîchissements par seconde. */
const PUBLISH_INTERVAL_MS = 100;

export function useRide() {
  const status = ref('idle'); // idle | loading | ready | error
  const errorMessage = ref('');
  const route = shallowRef(null); // descripteur, non réactif en profondeur

  // Compteurs publiés vers l'interface.
  const distanceM = ref(0);
  const speedKmh = ref(0);
  const gradePct = ref(0);
  const laps = ref(0);
  const elapsedS = ref(0);

  // --- Non réactif ---------------------------------------------------------
  let ride = null;
  let targetSpeedMs = 0;
  let lastPublishMs = 0;
  let elapsed = 0;

  async function load(routeId) {
    status.value = 'loading';
    errorMessage.value = '';
    try {
      const loaded = await loadRoute(findRoute(routeId));
      ride = createRideState({ path: loaded.path, loop: loaded.descriptor.loop });
      route.value = loaded.descriptor;
      targetSpeedMs = (KEYBOARD_START_KMH * 1000) / 3600;
      elapsed = 0;
      publish(true);
      status.value = 'ready';
    } catch (e) {
      status.value = 'error';
      errorMessage.value = e?.message || 'parcours indisponible';
      console.warn('[ride] chargement impossible', e);
    }
  }

  /**
   * Une image de jeu. Appelée par la boucle de rendu de la scène, qui est la
   * seule horloge — cf. `useRideScene`.
   */
  function frame(deltaS) {
    if (!ride) return;
    ride.advance(deltaS, targetSpeedMs);
    elapsed += deltaS;
    publish();
  }

  function publish(force = false) {
    if (!ride) return;
    const now = performance.now();
    if (!force && now - lastPublishMs < PUBLISH_INTERVAL_MS) return;
    lastPublishMs = now;
    distanceM.value = ride.distanceM;
    speedKmh.value = ride.speedMs * 3.6;
    gradePct.value = ride.gradeAt * 100;
    laps.value = ride.laps;
    elapsedS.value = elapsed;
  }

  /** Pilote provisoire : la vitesse se règle au clavier. Voir l'en-tête. */
  function nudgeSpeed(deltaKmh) {
    const kmh = Math.min(
      KEYBOARD_MAX_KMH,
      Math.max(KEYBOARD_MIN_KMH, targetSpeedMs * 3.6 + deltaKmh)
    );
    targetSpeedMs = (kmh * 1000) / 3600;
  }

  function onKeydown(event) {
    if (event.key === 'ArrowUp') {
      nudgeSpeed(KEYBOARD_STEP_KMH);
      event.preventDefault();
    } else if (event.key === 'ArrowDown') {
      nudgeSpeed(-KEYBOARD_STEP_KMH);
      event.preventDefault();
    }
  }

  window.addEventListener('keydown', onKeydown);
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));

  return {
    status,
    errorMessage,
    route,
    distanceM,
    speedKmh,
    gradePct,
    laps,
    elapsedS,
    load,
    frame,
    nudgeSpeed,
    /** Lu par la scène à chaque image. Jamais rendu réactif. */
    getRide: () => ride,
  };
}
