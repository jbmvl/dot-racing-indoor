/*
 * useTrainer — la liaison Bluetooth avec le capteur de puissance.
 * ---------------------------------------------------------------------
 *
 * On lit le service standard **Cycling Power** (0x1818), que publient tous les
 * home-trainers connectés et tous les capteurs de puissance. On ne pilote pas
 * la résistance : cela demande FTMS, dont l'implémentation est inégale selon
 * les marques, et ce n'est pas ce qui manque pour rouler.
 *
 * ## Deux puissances, et il ne faut pas les confondre
 *
 * | | |
 * |---|---|
 * | `getPowerW()` | la valeur **brute**, pour la physique |
 * | `displayPowerW` | la même, moyennée sur trois secondes, pour l'écran |
 *
 * La puissance d'un capteur saute de plusieurs dizaines de watts d'une seconde
 * à l'autre : c'est réel, cela suit le coup de pédale. Illisible à l'écran,
 * mais c'est bien la valeur brute qu'il faut intégrer — lisser avant, c'est
 * lisser deux fois, et le vélo perdrait le mordant des relances.
 *
 * `getPowerW` est une fonction et non un `ref` : elle est lue à chaque image
 * par la boucle de rendu, et il n'y a aucune raison de faire traverser la
 * réactivité de Vue à une valeur qui change soixante fois par seconde.
 *
 * ## Web Bluetooth
 *
 * Disponible sur Chrome et Edge, bureau et Android. **Absent d'iOS**, où tous
 * les navigateurs sont contraints à WebKit — ce n'est pas une lacune de ce
 * code, et rien ici ne peut la combler. `supported` le dit, l'interface doit
 * en tenir compte.
 *
 * L'appairage exige un geste de l'utilisateur et une page en HTTPS (ou
 * localhost) : `connect()` ne peut donc être appelé que depuis un clic.
 */

import { ref, onBeforeUnmount } from 'vue';
import {
  CYCLING_POWER_SERVICE,
  CYCLING_POWER_MEASUREMENT,
  parsePowerMeasurement,
  createCadenceReader,
  createPowerSmoother,
} from '@/lib/trainer/cyclingPower.js';

/** Sans trame pendant ce délai, on considère qu'il n'y a plus de puissance. */
const SIGNAL_TIMEOUT_MS = 5000;

export function useTrainer() {
  const supported = typeof navigator !== 'undefined' && !!navigator.bluetooth;
  const status = ref(supported ? 'idle' : 'unsupported'); // idle | connecting | connected | error
  const errorMessage = ref('');
  const deviceName = ref('');
  const displayPowerW = ref(0);
  const cadenceRpm = ref(0);

  // --- Non réactif ---------------------------------------------------------
  let device = null;
  let characteristic = null;
  let rawPowerW = 0;
  let lastSampleMs = 0;
  const cadence = createCadenceReader();
  const smoother = createPowerSmoother(3000);

  function onMeasurement(event) {
    let sample;
    try {
      sample = parsePowerMeasurement(event.target.value);
    } catch (e) {
      // Une trame illisible n'est pas une déconnexion : on saute celle-là.
      return;
    }
    const now = performance.now();
    // Une puissance négative (certains capteurs en publient en descente) n'a
    // pas de sens pour la traction : le vélo n'est pas propulsé à reculons.
    rawPowerW = Math.max(0, sample.powerW);
    lastSampleMs = now;
    displayPowerW.value = smoother.push(rawPowerW, now);
    const rpm = cadence.push(sample, now);
    if (rpm != null) cadenceRpm.value = rpm;
  }

  function onDisconnected() {
    status.value = 'idle';
    rawPowerW = 0;
    displayPowerW.value = 0;
    cadenceRpm.value = 0;
    cadence.reset();
    smoother.reset();
    characteristic = null;
  }

  async function connect() {
    if (!supported) return;
    status.value = 'connecting';
    errorMessage.value = '';
    try {
      device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [CYCLING_POWER_SERVICE] }],
      });
      device.addEventListener('gattserverdisconnected', onDisconnected);

      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(CYCLING_POWER_SERVICE);
      characteristic = await service.getCharacteristic(CYCLING_POWER_MEASUREMENT);
      await characteristic.startNotifications();
      characteristic.addEventListener('characteristicvaluechanged', onMeasurement);

      deviceName.value = device.name || 'capteur';
      status.value = 'connected';
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

  function disconnect() {
    try {
      characteristic?.removeEventListener('characteristicvaluechanged', onMeasurement);
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
    // autant : au bout de quelques secondes, la dernière valeur ne vaut plus
    // rien.
    if (performance.now() - lastSampleMs > SIGNAL_TIMEOUT_MS) return 0;
    return rawPowerW;
  }

  onBeforeUnmount(disconnect);

  return {
    supported,
    status,
    errorMessage,
    deviceName,
    displayPowerW,
    cadenceRpm,
    connect,
    disconnect,
    getPowerW,
  };
}
