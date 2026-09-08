/*
 * useRideScene — le cycle de vie de la scène 3D d'une séance d'intérieur.
 * ---------------------------------------------------------------------
 *
 * Ce composable ne fabrique rien du décor : il tient le contexte WebGL, la
 * caméra, l'assiette du vélo et l'ambiance, et délègue tout le monde visible à
 * `worldpaint`, qui possède la bulle de terrain et ses couches.
 *
 * **Aucun objet three.js n'est rendu réactif.** C'est délibéré : envelopper une
 * scène WebGL dans un `ref()` fait proxifier tout son graphe interne par Vue,
 * et le rendu déclenche alors une cascade de réactivité à 60 images/seconde qui
 * fige l'onglet. Les objets 3D vivent donc dans des variables de fermeture, et
 * seuls des scalaires remontent au composant.
 *
 * ## Ce qui a disparu par rapport à Dot Racing, et pourquoi
 *
 * L'ancêtre de ce fichier lisait un **flux diffusé** : le serveur envoyait une
 * position toutes les cinq secondes, et trois organes — horloge de course,
 * suiveur de distance, ancre de tracé — travaillaient à rattraper ce retard
 * sans que le joueur le voie. Ici, le coureur possède sa distance : elle avance
 * sous ses jambes, à chaque image. Il n'y a plus de retard, donc plus rien à
 * rattraper. Ces trois organes ne sont pas « pas encore branchés » : ils n'ont
 * pas lieu d'être, et les rebrancher serait une régression.
 *
 * Ce qui reste de leur héritage tient en une ligne, et il faut la garder : le
 * **cap est lissé**. Il vient de la tangente du tracé, qui change par paliers
 * à chaque sommet de la polyligne ; sans lissage, le vélo se braquerait par
 * à-coups. Un dixième de seconde suffit, et pas davantage — un vélo dont le cap
 * traîne sur son déplacement glisse en crabe.
 */

import { ref, watch, onBeforeUnmount } from 'vue';
import {
  createWorld,
  SKY_RADIUS,
  SHADOW_LEAD_M,
  ROAD_LIFT_M,
  tileSizeMeters,
  bearingToYaw,
  WORLD_ATTRIBUTION,
} from 'worldpaint';
import { RiderModel } from '@/lib/riderScene/riderModel.js';
import { createRiderPose, attitudeFromGround } from '@/lib/riderScene/riderPose.js';
import { normalizeBearing, shortestAngleDelta } from '@/lib/riderScene/raceClock.js';
import { offsetBy } from '@/lib/riderScene/riderCrowd.js';
import {
  BUBBLE_ZOOM,
  BUBBLE_TILES,
  BUBBLE_SEGMENTS_BY_RING,
  resolveVectorSource,
} from '@/config/scene.js';

/** Caméra de poursuite : recul, hauteur, et avance du point visé. */
export const CAMERA_BACK_M = 16;
export const CAMERA_UP_M = 5.5;
export const CAMERA_LOOK_AHEAD_M = 14;
/** Garde au sol : la caméra ne passe jamais sous le relief. */
export const CAMERA_MIN_CLEARANCE_M = 2.5;

/** Lissage de la caméra (suivi) et du terrain sous elle (assiette). */
const SMOOTHING_CAMERA = 2.6;
const SMOOTHING_GROUND = 1.2;
const RECENTER_INTERVAL_MS = 700;

/** Empattement et largeur d'appui du vélo, en mètres — cf. `sampleContact`. */
const CONTACT_SPAN_M = 1.05;
const CONTACT_WIDTH_M = 0.9;

/**
 * Danseuse — feedback visuel d'une accélération. Dot Racing la déclenchait sur
 * le « pace » de son moteur ; ici la seule accélération dont on dispose est
 * celle du sol, et c'est la bonne : c'est elle que le joueur vient de produire
 * en appuyant.
 */
const DANCE_ACCEL_MS2 = 0.35;
const DANCE_HOLD_MS = 4000;
const DANCE_SMOOTHING = 4;

/**
 * @param {Object} options
 * @param {import('vue').Ref<HTMLCanvasElement|null>} options.canvasRef
 * @param {() => Object|null} options.getRide État de séance (`rideState`).
 *        Lu à chaque image, jamais conservé : la séance peut être remplacée.
 * @param {import('vue').Ref<boolean>} options.active
 * @param {import('vue').Ref<boolean>} [options.paused] Gèle le rendu sans rien
 *        libérer : le contexte WebGL, le terrain et les shaders restent en
 *        place, seule la boucle rAF s'arrête. Un vrai démontage coûterait un
 *        rechargement complet de la bulle, et les contextes WebGL sont
 *        contingentés par le navigateur.
 * @param {(deltaS: number) => void} [options.onFrame] Appelé au début de
 *        chaque image, avant tout rendu. **La boucle rAF de la scène est la
 *        seule horloge du jeu** : c'est ici que l'appelant fait avancer sa
 *        séance. Deux boucles séparées finiraient par diverger, et le décalage
 *        se verrait exactement là où on ne veut pas — sous les roues.
 * @param {() => number|undefined} [options.getPowerW] Puissance instantanée, en
 *        watts. Elle ne sert qu'aux jambes : à zéro, elles s'arrêtent net (roue
 *        libre). Inconnue, le pédalage se déduit de la vitesse.
 * @param {() => string|undefined} [options.getRiderColor]
 * @param {() => Date} [options.getDate] Heure du ciel. Par défaut, l'heure réelle.
 * @param {() => Object|undefined} [options.getWeather] Météo au format worldpaint.
 */
export function useRideScene({
  canvasRef,
  getRide,
  active,
  paused: pausedRef = null,
  onFrame = null,
  getPowerW = () => undefined,
  getRiderColor = () => undefined,
  getDate = () => new Date(),
  getWeather = () => undefined,
}) {
  const state = ref('idle'); // idle | loading | ready | error
  const errorMessage = ref('');
  const attribution = ref('');

  // --- Objets non réactifs -------------------------------------------------
  let THREE = null;
  let SkyClass = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let world = null;
  let rider = null;
  let resizeObserver = null;
  let frameId = null;
  let lastFrameTime = 0;
  let recenterTimer = null;
  let recentering = false;
  let paused = false;
  let cameraPosition = null; // THREE.Vector3
  let lookTarget = null; // THREE.Vector3

  // Lecture rendue : le cap est lissé, la position ne l'est pas (elle est déjà
  // continue — c'est une distance qui court sur une polyligne).
  let smoothBearing = 0;
  let smoothGroundY = null;
  let smoothFloorY = null;
  let lastSpeed = 0;
  let danceUntilMs = 0;
  let danceAmount = 0;
  // Tours déjà vus. Repasser la ligne se déduit de ce compteur plutôt que d'un
  // drapeau posé sur la séance : la scène observe l'état du jeu, elle n'écrit
  // pas dedans.
  let seenLaps = 0;

  const pose = createRiderPose();

  /** Position courante du coureur. `null` tant que la séance n'est pas prête. */
  function currentPlace() {
    const ride = getRide?.();
    if (!ride) return null;
    const at = ride.positionAt();
    return Number.isFinite(at?.lng) && Number.isFinite(at?.lat) ? at : null;
  }

  // --- Montage -------------------------------------------------------------

  async function mount() {
    if (renderer || state.value === 'loading') return;
    const canvas = canvasRef.value;
    const start = currentPlace();
    if (!canvas || !start) return;

    state.value = 'loading';
    errorMessage.value = '';

    try {
      // Sky vient du même import dynamique : statique, il entraînerait three
      // dans le lot de la page d'accueil et le chunk cesserait d'être partagé.
      [THREE, SkyClass] = await Promise.all([
        import('three'),
        import('three/examples/jsm/objects/Sky.js').then((m) => m.Sky),
      ]);
    } catch (e) {
      state.value = 'error';
      errorMessage.value = 'moteur 3D indisponible';
      console.warn('[rideScene] chargement de three.js impossible', e?.message || e);
      return;
    }
    if (!active.value || !canvasRef.value) {
      state.value = 'idle';
      return;
    }

    // La source vectorielle est résolue une fois, avant de bâtir le décor :
    // sans elle il ne reste que le relief, et on ne saurait plus l'enrichir
    // ensuite. Elle ne fait pas échouer le montage pour autant.
    const vectorConfig = await resolveVectorSource();
    if (!active.value || !canvasRef.value) {
      state.value = 'idle';
      return;
    }

    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
        failIfMajorPerformanceCaveat: false,
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      // worldpaint pousse volontairement son éclairage au-dessus de 1 : sans
      // courbe de rendu, `NoToneMapping` écrête cela en blanc plat.
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      // Les ombres doivent être activées **avant** que les matériaux se
      // compilent : elles font partie de la clé de programme.
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(58, 1, 0.5, SKY_RADIUS * 2.2);
      cameraPosition = new THREE.Vector3();
      lookTarget = new THREE.Vector3();

      world = createWorld({
        THREE,
        scene,
        view: {
          zoom: BUBBLE_ZOOM,
          blockSize: BUBBLE_TILES,
          segmentsByRing: BUBBLE_SEGMENTS_BY_RING,
          maxAnisotropy: renderer.capabilities.getMaxAnisotropy?.() ?? 4,
        },
        vector: vectorConfig,
        sky: {
          Sky: SkyClass,
          fogRadius: (BUBBLE_TILES / 2) * tileSizeMeters(BUBBLE_ZOOM, start.lat),
          // Une carte d'ombres est un carré de mémoire vidéo : 2048² coûte
          // 16 Mo. On la divise par deux sur les appareils qui ne peuvent pas
          // se le permettre, plutôt que de renoncer aux ombres.
          shadowMapSize: renderer.capabilities.maxTextureSize >= 8192 ? 2048 : 1024,
        },
      });
      attribution.value = WORLD_ATTRIBUTION;
      renderer.setClearColor(world.clearColor, 1);

      rider = new RiderModel({ THREE, scene, color: getRiderColor?.() });
      smoothBearing = normalizeBearing(start.bearing ?? 0);
      seenLaps = getRide?.()?.laps ?? 0;
      pose.seat();

      canvas.addEventListener('webglcontextlost', handleContextLost, false);
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(canvas.parentElement || canvas);
      document.addEventListener('visibilitychange', syncPaused);
      syncPaused();
      resize();

      await world.setCenter(start.lng, start.lat);
      if (!renderer) return; // démonté pendant le chargement
      await world.refresh(start.lng, start.lat, { force: true });
      if (!renderer) return;

      placeCameraImmediately();
      state.value = 'ready';
      startLoop();
      recenterTimer = setInterval(recenter, RECENTER_INTERVAL_MS);
      console.info(
        `[rideScene] bulle montée — zoom ${BUBBLE_ZOOM}, ${BUBBLE_TILES}×${BUBBLE_TILES} tuiles, ` +
          `rayon ~${Math.round(world.bubble.radiusMeters)} m` +
          (vectorConfig ? '' : ' — sans vectoriel, relief nu')
      );
    } catch (e) {
      state.value = 'error';
      errorMessage.value = e?.message || 'scène 3D indisponible';
      console.warn('[rideScene] montage impossible', e);
      unmount();
    }
  }

  // --- Boucle de rendu -----------------------------------------------------

  function startLoop() {
    if (frameId != null) return;
    lastFrameTime = performance.now();
    const tick = (now) => {
      frameId = requestAnimationFrame(tick);
      const delta = Math.min((now - lastFrameTime) / 1000, 0.25);
      lastFrameTime = now;
      if (!paused) render(delta);
    };
    frameId = requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (frameId != null) cancelAnimationFrame(frameId);
    frameId = null;
  }

  function render(delta) {
    if (!renderer || !world?.bubble) return;

    // L'appelant fait avancer sa séance avant que quoi que ce soit ne soit lu :
    // l'image rendue est celle de l'instant, pas celle d'avant.
    onFrame?.(delta);

    const ride = getRide?.();
    const at = ride ? ride.positionAt() : null;
    if (!at) return;

    // Le parcours vient de reboucler : l'abscisse a sauté d'un bout à l'autre
    // du tracé. Même sur une vraie boucle — où les deux bouts sont au même
    // endroit — le cap peut différer, et laisser la caméra rejoindre en
    // glissant lui ferait traverser le décor en vol.
    if (ride.laps !== seenLaps) {
      seenLaps = ride.laps;
      smoothBearing = normalizeBearing(at.bearing ?? smoothBearing);
      smoothGroundY = null;
      smoothFloorY = null;
      pose.seat();
      placeCameraImmediately();
      recenter();
    } else {
      setBearing(at.bearing, delta);
    }

    const speed = ride.speedMs;
    const bubble = world.bubble;
    const yaw = bearingToYaw(smoothBearing);
    // Le coureur roule sur la chaussée, pas sur le terrain nu : même
    // décollement que le ruban, sinon ses roues s'y enfoncent.
    const ground = bubble.toScenePosition(at.lng, at.lat, ROAD_LIFT_M);

    // Assiette : tangage et dévers lus sur le sol **effectivement rendu**, aux
    // quatre coins de l'empreinte du vélo. Un vélo rendu à plat sur une côte à
    // 8 % s'enfonce dans le bitume par la roue avant.
    const attitude = attitudeFromGround(sampleContact(bubble, at));
    const posed = pose.update(delta, {
      speed,
      curvature: ride.curvatureAt(),
      pitch: attitude.pitch,
      roll: attitude.roll,
    });
    rider.setPose(ground, yaw, posed.pitch, posed.roll);

    // Danseuse : quelques secondes debout dès que ça accélère franchement.
    if (delta > 0 && (speed - lastSpeed) / delta >= DANCE_ACCEL_MS2) {
      danceUntilMs = performance.now() + DANCE_HOLD_MS;
    }
    lastSpeed = speed;
    const danceTarget = performance.now() < danceUntilMs ? 1 : 0;
    danceAmount += (danceTarget - danceAmount) * Math.min(1, DANCE_SMOOTHING * delta);
    rider.setDance(danceAmount);

    // `power` commande les jambes : à zéro, elles s'arrêtent net (roue libre).
    // Tant que rien ne la fournit, le pédalage se déduit de la vitesse.
    rider.advance(delta, { speed, lean: posed.lean, power: getPowerW?.() });

    // Files étalées, herbe, vent, oiseaux et fumées : tout le travail d'image
    // du décor tient dans cet appel.
    world.advance(delta, ground);

    // Vecteur « devant » du coureur dans le repère de la scène.
    const forwardX = -Math.sin(yaw);
    const forwardZ = -Math.cos(yaw);

    const kc = 1 - Math.exp(-SMOOTHING_CAMERA * delta);
    cameraPosition.x += (ground.x - forwardX * CAMERA_BACK_M - cameraPosition.x) * kc;
    cameraPosition.z += (ground.z - forwardZ * CAMERA_BACK_M - cameraPosition.z) * kc;

    // Anti-encastrement : sur une pente montante, le relief derrière le coureur
    // est plus haut que lui et masquerait toute la scène.
    const rawFallback = ground.y / (bubble.verticalScale || 1);
    const rawFloor =
      bubble.surfaceElevationAtLocal(cameraPosition.x, cameraPosition.z, rawFallback) * bubble.verticalScale +
      CAMERA_MIN_CLEARANCE_M;

    // L'altitude est filtrée à part, et plus lentement que le suivi horizontal.
    // Le relief sous la caméra change à chaque maille franchie : appliqué tel
    // quel, il faisait tanguer l'assiette à chaque bosse — et un plancher
    // appliqué en dur produisait une saccade nette au passage d'une crête.
    const kg = 1 - Math.exp(-SMOOTHING_GROUND * delta);
    smoothFloorY = smoothFloorY == null ? rawFloor : smoothFloorY + (rawFloor - smoothFloorY) * kg;
    cameraPosition.y += (Math.max(ground.y + CAMERA_UP_M, smoothFloorY) - cameraPosition.y) * kc;

    // Point visé : son altitude est filtrée elle aussi, sinon l'inclinaison de
    // la caméra suit le moindre creux de la chaussée.
    const rawTargetY = ground.y + 1.6;
    smoothGroundY = smoothGroundY == null ? rawTargetY : smoothGroundY + (rawTargetY - smoothGroundY) * kg;

    camera.position.copy(cameraPosition);
    lookTarget.set(
      ground.x + forwardX * CAMERA_LOOK_AHEAD_M,
      smoothGroundY,
      ground.z + forwardZ * CAMERA_LOOK_AHEAD_M
    );
    camera.lookAt(lookTarget);

    // Les quatre gestes du ciel en un seul appel : dôme recalé sur la caméra,
    // soleil replacé, nuit propagée au décor, boîte d'ombres posée. Elle est
    // portée devant le coureur : la caméra regarde vers l'avant, la centrer sur
    // lui gâcherait la moitié de la carte dans son dos.
    const sky = world.updateSky({
      camera,
      date: getDate?.() ?? new Date(),
      lat: at.lat,
      lng: at.lng,
      weather: getWeather?.(),
      shadowAt: {
        x: ground.x + forwardX * SHADOW_LEAD_M,
        y: ground.y,
        z: ground.z + forwardZ * SHADOW_LEAD_M,
      },
    });

    // Le coureur s'allume sur la même mesure de nuit que le décor, sans quoi
    // ses feux basculeraient à contretemps des fenêtres.
    rider.setNight(sky.nightMix, camera.position.distanceTo(rider.group.position));

    renderer.setClearColor(sky.clearColor, 1);
    renderer.render(scene, camera);
  }

  /**
   * Les quatre points de sol qui portent l'assiette : devant et derrière pour
   * le tangage, de part et d'autre pour le dévers.
   *
   * On les prend sur le sol **rendu** (`toScenePosition`, qui applique déjà
   * l'entaille de la chaussée) et non sur la pente du parcours : c'est la
   * chaussée que touchent les roues, pas le profil du GPX.
   */
  function sampleContact(bubble, at) {
    const halfSpan = CONTACT_SPAN_M / 2;
    const halfWidth = CONTACT_WIDTH_M / 2;
    const front = offsetBy(at.lng, at.lat, smoothBearing, halfSpan);
    const rear = offsetBy(at.lng, at.lat, smoothBearing, -halfSpan);
    const left = offsetBy(at.lng, at.lat, smoothBearing + 90, -halfWidth);
    const right = offsetBy(at.lng, at.lat, smoothBearing + 90, halfWidth);
    return {
      front: bubble.toScenePosition(front.lng, front.lat, 0),
      rear: bubble.toScenePosition(rear.lng, rear.lat, 0),
      left: bubble.toScenePosition(left.lng, left.lat, 0),
      right: bubble.toScenePosition(right.lng, right.lat, 0),
      spanM: CONTACT_SPAN_M,
      widthM: CONTACT_WIDTH_M,
    };
  }

  /**
   * Fait tendre le cap rendu vers la tangente du tracé.
   *
   * Le lissage est court — un dixième de seconde — et n'est là que pour absorber
   * la marche d'escalier des sommets de la polyligne. Au-delà, il serait
   * nuisible : un vélo dont le cap traîne sur son déplacement glisse en crabe.
   */
  function setBearing(bearing, delta) {
    if (bearing == null) return;
    const wanted = normalizeBearing(bearing);
    if (!(delta > 0)) {
      smoothBearing = wanted;
      return;
    }
    const k = 1 - Math.exp(-delta / 0.1);
    smoothBearing = normalizeBearing(smoothBearing + shortestAngleDelta(smoothBearing, wanted) * k);
  }

  /** Pose la caméra sans lissage (premier rendu, passage de la ligne). */
  function placeCameraImmediately() {
    const at = currentPlace();
    if (!at || !world?.bubble) return;
    const yaw = bearingToYaw(smoothBearing);
    const ground = world.bubble.toScenePosition(at.lng, at.lat, 0);
    cameraPosition.set(
      ground.x + Math.sin(yaw) * CAMERA_BACK_M,
      ground.y + CAMERA_UP_M,
      ground.z + Math.cos(yaw) * CAMERA_BACK_M
    );
    camera.position.copy(cameraPosition);
  }

  /** Fait suivre la bulle et son décor. Appelé à intervalle fixe. */
  async function recenter({ force = false } = {}) {
    if (recentering || !world || world.disposed) return;
    const at = currentPlace();
    if (!at) return;
    recentering = true;
    try {
      await world.setCenter(at.lng, at.lat);
      await world.refresh(at.lng, at.lat, { force });
    } catch (e) {
      console.warn('[rideScene] recentrage impossible', e?.message || e);
    } finally {
      recentering = false;
    }
  }

  function resize() {
    if (!renderer || !camera) return;
    const host = canvasRef.value?.parentElement;
    if (!host) return;
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  /** Onglet caché ou pause demandée par l'app : même effet, une seule variable. */
  function syncPaused() {
    paused = document.hidden || pausedRef?.value === true;
  }

  function handleContextLost(event) {
    event.preventDefault();
    stopLoop();
    state.value = 'error';
    errorMessage.value = 'contexte WebGL perdu';
    console.warn('[rideScene] contexte WebGL perdu');
  }

  // --- Démontage -----------------------------------------------------------

  function unmount() {
    stopLoop();
    if (recenterTimer) clearInterval(recenterTimer);
    recenterTimer = null;

    document.removeEventListener('visibilitychange', syncPaused);
    resizeObserver?.disconnect();
    resizeObserver = null;
    canvasRef.value?.removeEventListener('webglcontextlost', handleContextLost);

    rider?.dispose();
    world?.dispose();

    if (renderer) {
      // Libère explicitement le contexte : sans cela, quelques allers-retours
      // suffisent à épuiser le quota de contextes du navigateur.
      renderer.dispose();
      renderer.forceContextLoss?.();
      renderer.domElement?.removeAttribute?.('data-engine');
    }

    rider = null;
    world = null;
    renderer = null;
    scene = null;
    camera = null;
    cameraPosition = null;
    lookTarget = null;
    THREE = null;
    SkyClass = null;
    smoothGroundY = null;
    smoothFloorY = null;
    lastSpeed = 0;
    danceAmount = 0;
    danceUntilMs = 0;
    seenLaps = 0;
    paused = false;
    if (state.value !== 'error') state.value = 'idle';
  }

  // --- Réactions -----------------------------------------------------------

  watch(
    () => active.value && !!canvasRef.value,
    (on) => {
      if (on) mount();
      else unmount();
    },
    { immediate: true, flush: 'post' }
  );

  if (pausedRef) watch(() => pausedRef.value, syncPaused);

  onBeforeUnmount(unmount);

  return { state, errorMessage, attribution };
}
