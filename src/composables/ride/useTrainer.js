/*
 * useTrainer — la liaison Bluetooth avec le home-trainer, dans les deux sens.
 * ---------------------------------------------------------------------
 *
 * Deux conversations sur un seul appareil, et elles n'ont rien à voir :
 *
 * | | |
 * |---|---|
 * | **ce qu'on écoute** | la puissance et la cadence, par Cycling Power (0x1818) ou, à défaut, par Indoor Bike Data (0x2AD2) |
 * | **ce qu'on dicte** | la pente, par le point de commande FTMS (0x2AD9) en mode simulation |
 *
 * ## Pourquoi deux services pour écouter
 *
 * Cycling Power est le service universel : toutes les pédales, toutes les
 * manivelles, tous les home-trainers le publient. Mais certains
 * home-trainers récents ne publient **que** FTMS, et n'interroger que le
 * premier les rendrait muets — une panne pénible à diagnostiquer, parce que
 * l'appairage, lui, réussit. On essaie donc Cycling Power, puis FTMS en repli.
 * Le sens inverse n'existe pas : Cycling Power ne commande rien.
 *
 * ## La pente, et à quel rythme elle part
 *
 * Le rythme d'écriture n'est pas un détail de confort, c'est ce qui décide si
 * la pente ressentie est la bonne : trop souvent, la file BLE déborde et la
 * machine applique une pente vieille de plusieurs secondes ; trop rarement,
 * l'autorisation de commande expire au bout d'une minute et la machine cesse
 * d'obéir en pleine côte. `createGradeWriter` tient cet arbitrage, et il se
 * teste sans matériel — cf. `lib/trainer/ftms.js`.
 *
 * `setGrade` est appelée à chaque image et ne promet rien : elle décide, puis
 * écrit si c'est le moment. C'est une fonction et non un `watch` sur un `ref` :
 * rien ne justifie de faire traverser la réactivité de Vue à une valeur lue
 * soixante fois par seconde.
 *
 * ## On rend la machine à elle-même en partant
 *
 * Une machine quittée en pleine simulation garde la dernière pente reçue : le
 * coureur suivant trouve un home-trainer bloqué sur un mur à 12 %, sans rien
 * qui l'explique. `disconnect` envoie donc un `Reset`, et attend qu'il parte
 * avant de couper.
 *
 * ## Web Bluetooth
 *
 * Chrome et Edge, bureau et Android. **Absent d'iOS**, où tous les navigateurs
 * sont contraints à WebKit — ce n'est pas une lacune de ce code, et rien ici ne
 * peut la combler. `supported` le dit, l'interface doit en tenir compte.
 * L'appairage exige un geste de l'utilisateur et une page en HTTPS (ou
 * localhost) : `connect()` ne peut être appelée que depuis un clic.
 */

import { ref, onBeforeUnmount } from 'vue';
import {
  CYCLING_POWER_SERVICE,
  CYCLING_POWER_MEASUREMENT,
  parsePowerMeasurement,
  createCadenceReader,
  createPowerSmoother,
} from '@/lib/trainer/cyclingPower.js';
import {
  FITNESS_MACHINE_SERVICE,
  FITNESS_MACHINE_FEATURE,
  FITNESS_MACHINE_CONTROL_POINT,
  INDOOR_BIKE_DATA,
  encodeSimulation,
  encodeRequestControl,
  encodeReset,
  parseControlResponse,
  parseFeature,
  parseIndoorBikeData,
  windCoefficient,
  createGradeWriter,
  OP_REQUEST_CONTROL,
} from '@/lib/trainer/ftms.js';
import { airDensity, DEFAULT_SETUP } from '@/lib/ride/physics.js';

/** Sans trame pendant ce délai, on considère qu'il n'y a plus de puissance. */
const SIGNAL_TIMEOUT_MS = 5000;
/** Au-delà, on cesse d'attendre la réponse à une demande de contrôle. */
const CONTROL_RESPONSE_TIMEOUT_MS = 2000;

export function useTrainer() {
  const supported = typeof navigator !== 'undefined' && !!navigator.bluetooth;
  const status = ref(supported ? 'idle' : 'unsupported'); // idle | connecting | connected | error
  const errorMessage = ref('');
  const deviceName = ref('');
  const displayPowerW = ref(0);
  const cadenceRpm = ref(0);
  /**
   * État du pilotage de résistance, distinct de celui de la liaison : un
   * home-trainer parfaitement connecté peut très bien ne pas se laisser
   * commander, et l'interface doit pouvoir le dire.
   *
   * `none` (rien de tenté) | `unavailable` (la machine ne sait pas simuler)
   * | `denied` (elle a refusé la commande) | `active`
   */
  const control = ref('none');
  /** Pente effectivement transmise, en tangente — ce que la machine applique. */
  const appliedGrade = ref(0);

  // --- Non réactif ---------------------------------------------------------
  let device = null;
  let measurement = null; // caractéristique écoutée (CPS ou FTMS)
  let controlPoint = null;
  let rawPowerW = 0;
  let lastSampleMs = 0;
  let writing = false;
  /** Résolutions en attente d'une réponse du point de commande, par code d'ordre. */
  const pending = new Map();
  const cadence = createCadenceReader();
  const smoother = createPowerSmoother(3000);
  const gradeWriter = createGradeWriter();

  /** Une puissance négative (certains capteurs en publient en descente) ne
   *  propulse pas : le vélo n'avance pas à reculons. */
  function pushPower(powerW, nowMs) {
    rawPowerW = Math.max(0, powerW);
    lastSampleMs = nowMs;
    displayPowerW.value = smoother.push(rawPowerW, nowMs);
  }

  function onPowerMeasurement(event) {
    let sample;
    try {
      sample = parsePowerMeasurement(event.target.value);
    } catch (e) {
      // Une trame illisible n'est pas une déconnexion : on saute celle-là.
      return;
    }
    const now = performance.now();
    pushPower(sample.powerW, now);
    const rpm = cadence.push(sample, now);
    if (rpm != null) cadenceRpm.value = rpm;
  }

  function onBikeData(event) {
    let sample;
    try {
      sample = parseIndoorBikeData(event.target.value);
    } catch (e) {
      return;
    }
    // Indoor Bike Data donne la cadence directement : pas de compteurs de
    // manivelle à dérouler, donc pas de repli 16 bits à traiter ici.
    if (sample.powerW != null) pushPower(sample.powerW, performance.now());
    if (sample.cadenceRpm != null) cadenceRpm.value = sample.cadenceRpm;
  }

  function onControlResponse(event) {
    const response = parseControlResponse(event.target.value);
    if (!response) return;
    const waiter = pending.get(response.requestOp);
    if (waiter) {
      pending.delete(response.requestOp);
      waiter(response);
    }
    // Une machine peut retirer son autorisation en cours de route (arrêt
    // d'urgence, passage en mode manuel sur l'écran de l'appareil). Le dire
    // vaut mieux que continuer d'écrire dans le vide.
    if (!response.ok && response.requestOp !== OP_REQUEST_CONTROL) {
      control.value = 'denied';
    }
  }

  /** Attend la réponse à un ordre — `null` si la machine ne répond pas. */
  function awaitResponse(opCode, timeoutMs = CONTROL_RESPONSE_TIMEOUT_MS) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(opCode);
        resolve(null);
      }, timeoutMs);
      pending.set(opCode, (response) => {
        clearTimeout(timer);
        resolve(response);
      });
    });
  }

  function onDisconnected() {
    status.value = 'idle';
    control.value = 'none';
    rawPowerW = 0;
    displayPowerW.value = 0;
    cadenceRpm.value = 0;
    appliedGrade.value = 0;
    cadence.reset();
    smoother.reset();
    gradeWriter.reset();
    pending.clear();
    measurement = null;
    controlPoint = null;
  }

  /** Écoute la puissance : Cycling Power d'abord, Indoor Bike Data en repli. */
  async function listenToPower(server) {
    try {
      const service = await server.getPrimaryService(CYCLING_POWER_SERVICE);
      measurement = await service.getCharacteristic(CYCLING_POWER_MEASUREMENT);
      await measurement.startNotifications();
      measurement.addEventListener('characteristicvaluechanged', onPowerMeasurement);
      return;
    } catch (e) {
      // Pas de Cycling Power : c'est le cas des machines qui ne parlent que FTMS.
    }
    const service = await server.getPrimaryService(FITNESS_MACHINE_SERVICE);
    measurement = await service.getCharacteristic(INDOOR_BIKE_DATA);
    await measurement.startNotifications();
    measurement.addEventListener('characteristicvaluechanged', onBikeData);
  }

  /**
   * Demande le droit de commander la résistance.
   *
   * Aucun échec ici n'est fatal : on roule très bien sans pilotage, la pente
   * reste dans les jambes du modèle physique. C'est pourquoi tout est rattrapé
   * et rapporté dans `control` plutôt que remonté en erreur de connexion.
   */
  async function takeControl(server) {
    let service;
    try {
      service = await server.getPrimaryService(FITNESS_MACHINE_SERVICE);
    } catch (e) {
      control.value = 'unavailable';
      return;
    }

    try {
      // La liste des capacités est obligatoire dans la spécification, mais une
      // machine qui ne la publie pas peut très bien savoir simuler : on ne
      // renonce que sur un refus explicite.
      const feature = parseFeature(await (await service.getCharacteristic(FITNESS_MACHINE_FEATURE)).readValue());
      if (!feature.simulation) {
        control.value = 'unavailable';
        return;
      }
    } catch (e) {
      console.info('[trainer] capacités FTMS illisibles, on tente la commande');
    }

    try {
      controlPoint = await service.getCharacteristic(FITNESS_MACHINE_CONTROL_POINT);
      await controlPoint.startNotifications();
      controlPoint.addEventListener('characteristicvaluechanged', onControlResponse);

      const waited = awaitResponse(OP_REQUEST_CONTROL);
      await write(encodeRequestControl());
      const response = await waited;
      // Pas de réponse n'est pas un refus : certaines machines n'indiquent
      // rien et obéissent. Un refus, lui, est explicite.
      if (response && !response.ok) {
        control.value = 'denied';
        return;
      }
      control.value = 'active';
    } catch (e) {
      control.value = 'unavailable';
      console.warn('[trainer] pilotage de résistance indisponible', e?.message || e);
      controlPoint = null;
    }
  }

  /** Écrit sur le point de commande. FTMS impose une écriture avec accusé. */
  function write(frame) {
    if (!controlPoint) return Promise.resolve();
    return controlPoint.writeValueWithResponse
      ? controlPoint.writeValueWithResponse(frame)
      : controlPoint.writeValue(frame);
  }

  async function connect() {
    if (!supported) return;
    status.value = 'connecting';
    errorMessage.value = '';
    try {
      device = await navigator.bluetooth.requestDevice({
        // Deux filtres, pas un service à deux entrées : une machine qui ne
        // publie que l'un des deux doit apparaître dans la liste.
        filters: [
          { services: [FITNESS_MACHINE_SERVICE] },
          { services: [CYCLING_POWER_SERVICE] },
        ],
        optionalServices: [FITNESS_MACHINE_SERVICE, CYCLING_POWER_SERVICE],
      });
      device.addEventListener('gattserverdisconnected', onDisconnected);

      const server = await device.gatt.connect();
      await listenToPower(server);

      deviceName.value = device.name || 'capteur';
      status.value = 'connected';

      // Après la puissance : sans elle, il n'y a pas de séance ; sans le
      // pilotage, il y en a une, simplement moins convaincante.
      await takeControl(server);
    } catch (e) {
      // Refuser le dialogue d'appairage n'est pas une panne : c'est un choix.
      if (e?.name === 'NotFoundError') {
        status.value = 'idle';
        return;
      }
      status.value = 'error';
      errorMessage.value = e?.message || 'connexion impossible';
      console.warn('[trainer] connexion impossible', e);
    }
  }

  async function disconnect() {
    try {
      // Rendre la machine à elle-même **avant** de couper : une fois le GATT
      // fermé, la dernière pente reçue reste appliquée.
      if (controlPoint && control.value === 'active') await write(encodeReset());
    } catch (e) {
      console.warn('[trainer] remise à zéro de la machine impossible', e?.message || e);
    }
    try {
      measurement?.removeEventListener('characteristicvaluechanged', onPowerMeasurement);
      measurement?.removeEventListener('characteristicvaluechanged', onBikeData);
      controlPoint?.removeEventListener('characteristicvaluechanged', onControlResponse);
      device?.removeEventListener('gattserverdisconnected', onDisconnected);
      if (device?.gatt?.connected) device.gatt.disconnect();
    } catch (e) {
      console.warn('[trainer] déconnexion imparfaite', e?.message || e);
    }
    device = null;
    onDisconnected();
  }

  /**
   * La puissance à intégrer, en watts — `null` quand aucun capteur ne parle.
   *
   * `null` et non zéro : zéro voudrait dire « le coureur ne pousse pas », ce
   * qui est une information, alors qu'ici on n'en a aucune. C'est cette
   * distinction qui permet au clavier de reprendre la main sans se battre avec
   * un capteur muet.
   */
  function getPowerW() {
    if (status.value !== 'connected') return null;
    // Un capteur qui se tait ne veut pas dire un coureur qui pousse toujours
    // autant : au bout de quelques secondes, la dernière valeur ne vaut plus rien.
    if (performance.now() - lastSampleMs > SIGNAL_TIMEOUT_MS) return 0;
    return rawPowerW;
  }

  /**
   * Fait ressentir la pente. Appelée à chaque image ; n'écrit que si c'est le
   * moment — cf. `createGradeWriter`.
   *
   * @param {number} grade pente en **tangente** (0,08 = 8 %), sous le coureur.
   * @param {Object} [setup] gabarit courant : le roulement et la pénétration
   *        dans l'air partent avec la pente, pour que la machine applique le
   *        même modèle que le nôtre plutôt que ses valeurs d'usine.
   */
  function setGrade(grade, { Crr = DEFAULT_SETUP.Crr, CdA = DEFAULT_SETUP.CdA, altitudeM = 0 } = {}) {
    if (control.value !== 'active' || writing) return;
    const now = performance.now();
    if (!gradeWriter.shouldWrite(grade, now)) return;

    // Retenu avant l'écriture : deux images peuvent se succéder avant qu'elle
    // parte, et la seconde ne doit pas en déclencher une deuxième.
    gradeWriter.commit(grade, now);
    writing = true;
    write(encodeSimulation({ grade, Crr, cw: windCoefficient(CdA, airDensity(altitudeM)) }))
      .then(() => {
        appliedGrade.value = grade;
      })
      .catch((e) => {
        // Une écriture perdue n'est pas une déconnexion : la suivante arrive
        // dans un quart de seconde. On oublie seulement la pente retenue, pour
        // que la prochaine reparte même identique.
        gradeWriter.reset();
        console.warn('[trainer] pente non transmise', e?.message || e);
      })
      .finally(() => {
        writing = false;
      });
  }

  onBeforeUnmount(disconnect);

  return {
    supported,
    status,
    errorMessage,
    deviceName,
    displayPowerW,
    cadenceRpm,
    control,
    appliedGrade,
    connect,
    disconnect,
    getPowerW,
    setGrade,
  };
}
