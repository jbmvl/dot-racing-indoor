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
 * La vitesse ne se décide plus ici : elle sort du modèle physique, qui prend
 * une puissance et une pente. Le clavier pilote donc des **watts**, comme le
 * fera le home-trainer au lot 4 — et le jour où celui-ci arrivera, il n'y aura
 * qu'à remplacer la source de `powerW`. C'est la seule raison pour laquelle
 * `rideState.advance(delta, vitesse)` ignore d'où vient sa vitesse.
 */

import { ref, reactive, shallowRef, onBeforeUnmount } from 'vue';
import { createRideState } from '@/lib/ride/rideState.js';
import { createSpeedIntegrator, DEFAULT_SETUP } from '@/lib/ride/physics.js';

/**
 * Pilote clavier, en watts. Il ne disparaîtra pas quand le home-trainer
 * arrivera : c'est ce qui permet de développer sans vélo, et de tester une
 * pente sans la grimper.
 */
export const KEYBOARD_START_W = 150;
export const KEYBOARD_MIN_W = 0;
export const KEYBOARD_MAX_W = 600;
export const KEYBOARD_STEP_W = 10;

/** Le tableau de bord n'a pas besoin de soixante rafraîchissements par seconde. */
const PUBLISH_INTERVAL_MS = 100;

export function useRide() {
  const status = ref('idle'); // idle | loading | ready | error
  const errorMessage = ref('');
  const route = shallowRef(null); // descripteur, non réactif en profondeur
  /*
   * Le tracé, pour le profil altimétrique. `shallowRef` et non `ref` : un
   * `RoutePath` porte des tableaux typés de plusieurs dizaines de milliers
   * d'entrées, que Vue proxifierait un à un sans le moindre bénéfice — rien
   * là-dedans ne change jamais.
   */
  const path = shallowRef(null);

  // Compteurs publiés vers l'interface.
  const distanceM = ref(0);
  /** Abscisse **sur le tracé** — celle que le profil altimétrique pointe. */
  const routeDistanceM = ref(0);
  const speedKmh = ref(0);
  const gradePct = ref(0);
  const laps = ref(0);
  const elapsedS = ref(0);
  const powerW = ref(0);
  const wattsPerKg = ref(0);

  // --- Non réactif ---------------------------------------------------------
  let ride = null;
  const integrator = createSpeedIntegrator();
  /*
   * Deux sources de puissance, et une règle de priorité simple : **le capteur
   * gagne quand il parle**. Il rend `null` quand il n'y a personne au bout du
   * Bluetooth, et c'est ce `null` — et non un zéro — qui permet au clavier de
   * reprendre la main sans se battre avec un capteur muet.
   */
  let powerSource = null;
  let keyboardPowerW = 0;
  let requestedPowerW = 0;
  let lastPublishMs = 0;
  let elapsed = 0;

  /**
   * Démarre une séance sur un parcours déjà résolu.
   *
   * La résolution n'appartient pas à ce composable : un parcours peut venir
   * d'un fichier livré ou du dépôt du navigateur, et la séance n'a aucune
   * raison de connaître cette différence — cf. `useRouteLibrary`.
   *
   * @param {() => Promise<{descriptor: Object, path: Object}>} resolver
   */
  async function load(resolver) {
    status.value = 'loading';
    errorMessage.value = '';
    try {
      const loaded = await resolver();
      ride = createRideState({ path: loaded.path, loop: loaded.descriptor.loop });
      route.value = loaded.descriptor;
      path.value = loaded.path;
      keyboardPowerW = KEYBOARD_START_W;
      requestedPowerW = KEYBOARD_START_W;
      integrator.reset(0);
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
    /*
     * L'ordre compte. La pente est lue **là où le coureur est**, avant qu'il
     * avance : intégrer sur la pente d'après reviendrait à lui faire subir une
     * côte qu'il n'a pas encore abordée — imperceptible à 30 km/h, franchement
     * faux au passage d'un sommet.
     */
    const measured = powerSource?.();
    requestedPowerW = measured != null ? measured : keyboardPowerW;

    const speedMs = integrator.advance(deltaS, {
      powerW: requestedPowerW,
      grade: ride.gradeAt,
      altitudeM: ride.altitudeM,
    });
    ride.advance(deltaS, speedMs);
    elapsed += deltaS;
    publish();
  }

  function publish(force = false) {
    if (!ride) return;
    const now = performance.now();
    if (!force && now - lastPublishMs < PUBLISH_INTERVAL_MS) return;
    lastPublishMs = now;
    distanceM.value = ride.distanceM;
    routeDistanceM.value = ride.routeDistanceM;
    speedKmh.value = ride.speedMs * 3.6;
    gradePct.value = ride.gradeAt * 100;
    laps.value = ride.laps;
    elapsedS.value = elapsed;
    powerW.value = requestedPowerW;
    wattsPerKg.value = requestedPowerW / setup.riderKg;
  }

  /** Règle la puissance du pilote clavier, en watts. */
  function nudgePower(deltaW) {
    keyboardPowerW = Math.min(KEYBOARD_MAX_W, Math.max(KEYBOARD_MIN_W, keyboardPowerW + deltaW));
  }

  /**
   * Branche une source de puissance extérieure — le home-trainer.
   *
   * Elle est lue **à chaque image**, et doit rendre `null` quand elle n'a rien
   * à dire. C'est une fonction et non un `ref` : rien ne justifie de faire
   * traverser la réactivité de Vue à une valeur lue soixante fois par seconde.
   *
   * @param {(() => number|null)|null} source
   */
  function setPowerSource(source) {
    powerSource = source;
  }

  /** Gabarit du coureur : la masse décide de tout en côte. */
  const setup = reactive({ ...DEFAULT_SETUP });

  function configure(next) {
    Object.assign(setup, next);
    integrator.configure(next);
  }

  function onKeydown(event) {
    if (event.key === 'ArrowUp') {
      nudgePower(KEYBOARD_STEP_W);
      event.preventDefault();
    } else if (event.key === 'ArrowDown') {
      nudgePower(-KEYBOARD_STEP_W);
      event.preventDefault();
    }
  }

  window.addEventListener('keydown', onKeydown);
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));

  return {
    status,
    errorMessage,
    route,
    path,
    distanceM,
    routeDistanceM,
    speedKmh,
    gradePct,
    laps,
    elapsedS,
    powerW,
    wattsPerKg,
    setup,
    configure,
    load,
    frame,
    nudgePower,
    setPowerSource,
    /** Lu par la scène à chaque image. Jamais rendu réactif. */
    getRide: () => ride,
  };
}
