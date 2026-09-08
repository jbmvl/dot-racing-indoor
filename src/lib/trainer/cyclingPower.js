/*
 * cyclingPower — décodage du service BLE Cycling Power (0x1818).
 * ---------------------------------------------------------------------
 *
 * C'est le protocole que **tout** capteur de puissance publie : home-trainer
 * connecté, pédales, manivelles, moyeu. Il est standard, public, et le même
 * partout — c'est ce qui permet de ne rien avoir à savoir de la marque du
 * matériel.
 *
 * ## La trame, et pourquoi elle est pénible
 *
 * `Cycling Power Measurement` (0x2A63) commence par seize bits de **drapeaux**,
 * puis la puissance instantanée. Tout ce qui suit est optionnel, et chaque
 * champ présent décale les suivants. Il n'y a donc pas de position fixe : lire
 * la cadence à un décalage codé en dur marche sur son propre matériel et
 * échoue chez le voisin. On avance donc drapeau par drapeau, en accumulant les
 * tailles — c'est tout ce que fait `parsePowerMeasurement`.
 *
 *     octets 0-1   drapeaux (uint16, petit-boutiste)
 *     octets 2-3   puissance instantanée (int16, en watts — signée : une
 *                  descente peut donner une valeur négative sur certains
 *                  capteurs)
 *     ensuite      les champs présents, dans l'ordre des drapeaux
 *
 * ## La cadence n'est pas dans la trame
 *
 * Ce que le capteur publie, ce sont deux **compteurs cumulés** : un nombre de
 * tours de manivelle, et l'horodatage du dernier tour (en 1/1024 s). La cadence
 * se déduit de leur variation entre deux trames — et les deux compteurs
 * repassent à zéro à 65 536. Ne pas traiter ce repli donne une cadence
 * aberrante toutes les dix minutes environ, ou toutes les minutes sur
 * l'horloge. C'est la panne classique de ces lecteurs.
 *
 * Module pur : il ne connaît ni Bluetooth, ni Vue, ni horloge. On lui donne un
 * `DataView`, il rend des nombres.
 */

/** UUID du service et de sa caractéristique de mesure. */
export const CYCLING_POWER_SERVICE = 0x1818;
export const CYCLING_POWER_MEASUREMENT = 0x2a63;

/** Les drapeaux qui nous intéressent, et la taille de ce qu'ils annoncent. */
const FLAG_FIELDS = [
  { bit: 0, bytes: 1 }, // équilibre gauche/droite
  { bit: 2, bytes: 2 }, // couple cumulé
  { bit: 4, bytes: 6 }, // tours de roue : uint32 + uint16
  { bit: 5, bytes: 4, crank: true }, // tours de manivelle : uint16 + uint16
  { bit: 6, bytes: 4 }, // forces extrêmes
  { bit: 7, bytes: 4 }, // couples extrêmes
  { bit: 8, bytes: 3 }, // angles extrêmes
  { bit: 9, bytes: 2 }, // point mort haut
  { bit: 10, bytes: 2 }, // point mort bas
  { bit: 11, bytes: 2 }, // énergie cumulée
];

/** Les compteurs 16 bits repassent à zéro : la différence doit en tenir compte. */
export function unwrap16(previous, current) {
  return (current - previous + 0x10000) % 0x10000;
}

/**
 * Décode une trame de mesure.
 *
 * @param {DataView} view
 * @returns {{powerW:number, crankRevolutions:number|null, crankEventTime:number|null}}
 * @throws {Error} si la trame est trop courte pour porter ne serait-ce que la
 *         puissance — mieux vaut le dire que rendre un zéro qui passera pour
 *         un coureur à l'arrêt.
 */
export function parsePowerMeasurement(view) {
  if (!view || view.byteLength < 4) throw new Error('trame de puissance trop courte');

  const flags = view.getUint16(0, true);
  const powerW = view.getInt16(2, true);

  let offset = 4;
  let crankRevolutions = null;
  let crankEventTime = null;

  for (const field of FLAG_FIELDS) {
    if (!(flags & (1 << field.bit))) continue;
    if (field.crank) {
      // Le seul champ optionnel qu'on lit vraiment. Les autres ne sont
      // traversés que pour savoir où commence le suivant.
      if (offset + 4 > view.byteLength) break;
      crankRevolutions = view.getUint16(offset, true);
      crankEventTime = view.getUint16(offset + 2, true);
    }
    offset += field.bytes;
    if (offset > view.byteLength) break;
  }

  return { powerW, crankRevolutions, crankEventTime };
}

/**
 * Cadence en tours par minute, déduite de deux trames successives.
 *
 * Rend `null` tant qu'il n'y a pas de quoi conclure : première trame, capteur
 * qui ne publie pas la manivelle, ou deux trames identiques — ce qui arrive
 * dès qu'on cesse de pédaler, le capteur continuant d'émettre sans que rien ne
 * tourne. Dans ce dernier cas la cadence tombe à zéro d'elle-même, après le
 * délai d'extinction.
 */
export function createCadenceReader({ stallMs = 3000 } = {}) {
  let lastRevolutions = null;
  let lastEventTime = null;
  /** Millisecondes (horloge de l'appelant) du dernier tour effectivement vu. */
  let lastTurnAtMs = null;
  let cadence = 0;

  return {
    get rpm() {
      return cadence;
    },
    reset() {
      lastRevolutions = null;
      lastEventTime = null;
      lastTurnAtMs = null;
      cadence = 0;
    },
    /**
     * @param {{crankRevolutions:number|null, crankEventTime:number|null}} sample
     * @param {number} nowMs horloge de l'appelant, pour l'extinction.
     * @returns {number|null} la cadence, ou `null` si le capteur ne la donne pas.
     */
    push({ crankRevolutions, crankEventTime }, nowMs = 0) {
      if (crankRevolutions == null || crankEventTime == null) return null;

      if (lastRevolutions == null) {
        lastRevolutions = crankRevolutions;
        lastEventTime = crankEventTime;
        lastTurnAtMs = nowMs;
        return cadence;
      }

      const turns = unwrap16(lastRevolutions, crankRevolutions);
      // L'horodatage est en 1/1024 s, et repasse à zéro comme le compteur.
      const ticks = unwrap16(lastEventTime, crankEventTime);

      if (turns > 0 && ticks > 0) {
        cadence = (turns * 60 * 1024) / ticks;
        lastRevolutions = crankRevolutions;
        lastEventTime = crankEventTime;
        lastTurnAtMs = nowMs;
      } else if (lastTurnAtMs != null && nowMs - lastTurnAtMs >= stallMs) {
        // Plus un tour depuis trois secondes : ce n'est plus une cadence lente,
        // c'est un arrêt.
        cadence = 0;
      }

      return cadence;
    },
  };
}

/**
 * Moyenne glissante de la puissance, pour l'**affichage seulement**.
 *
 * La puissance brute d'un capteur saute de plusieurs dizaines de watts d'une
 * seconde à l'autre — c'est réel, cela suit le coup de pédale. Illisible à
 * l'écran, mais c'est bien la valeur brute qu'il faut donner à la physique :
 * lisser avant d'intégrer, c'est lisser deux fois, et le vélo perdrait le
 * mordant des relances.
 *
 * @param {number} windowMs fenêtre de moyenne.
 */
export function createPowerSmoother(windowMs = 3000) {
  const samples = [];
  return {
    reset() {
      samples.length = 0;
    },
    /** @returns {number} la moyenne sur la fenêtre. */
    push(powerW, nowMs) {
      samples.push({ powerW, at: nowMs });
      while (samples.length > 0 && nowMs - samples[0].at > windowMs) samples.shift();
      const sum = samples.reduce((total, sample) => total + sample.powerW, 0);
      return samples.length > 0 ? sum / samples.length : 0;
    },
  };
}
