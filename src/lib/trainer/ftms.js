/*
 * ftms — le service BLE Fitness Machine (0x1826), côté commande.
 * ---------------------------------------------------------------------
 *
 * Cycling Power (`cyclingPower.js`) dit ce que le coureur produit. FTMS dit à
 * la machine ce qu'elle doit lui opposer : c'est le seul service standard qui
 * permet de faire **sentir la pente**. Sans lui, le home-trainer reste sur sa
 * propre résistance et le col n'existe qu'à l'écran.
 *
 * ## Le mode simulation, et pourquoi c'est celui-là
 *
 * FTMS offre trois façons de commander une machine :
 *
 * | | |
 * |---|---|
 * | puissance imposée (ERG) | la machine tient 250 W quoi qu'il arrive — c'est l'entraînement structuré, pas la course |
 * | résistance imposée | un cran de dureté, sans unité physique : incomparable d'une marque à l'autre |
 * | **simulation** | on décrit le monde (pente, vent, roulement, pénétration) et la machine calcule la force |
 *
 * C'est la simulation qu'il nous faut : c'est le seul mode où la **même pente
 * donne la même sensation** sur deux machines différentes, parce que chacune
 * applique le même modèle physique que le nôtre. Le coureur reste maître de sa
 * vitesse ; la machine ne fait que l'y aider ou l'en empêcher.
 *
 * ## Ce que la trame de simulation attend, et ses pièges
 *
 *     0x11  wind(sint16, 0,001 m/s)  grade(sint16, 0,01 %)
 *           crr(uint8, 0,0001)       cw(uint8, 0,01 kg/m)
 *
 * Deux pièges, et ils se ressemblent :
 *
 * 1. **La pente est en pourcents, pas en tangente.** Tout le reste du projet
 *    manipule une tangente (0,08 = 8 %), comme `RoutePath.gradeAt`. Envoyer la
 *    tangente telle quelle donnerait une pente cent fois trop faible — un col
 *    parfaitement plat sous les jambes, sans le moindre message d'erreur.
 * 2. **`cw` n'est pas le CdA.** C'est un demi-CdA multiplié par la masse
 *    volumique de l'air : `cw = ½·ρ·CdA`. C'est exactement le coefficient qui
 *    apparaît dans notre propre force aérodynamique — d'où `windCoefficient`,
 *    qui le calcule à partir du gabarit du coureur plutôt que de le deviner.
 *
 * ## L'autorisation, qui se perd
 *
 * Une machine n'accepte d'être commandée qu'après un `Request Control` (0x00)
 * réussi, et elle **révoque** cette autorisation après une minute sans ordre —
 * c'est dans la spécification, pas un caprice de marque. Une écriture ne peut
 * donc pas attendre que la pente change : `createGradeWriter` en garantit une
 * au moins toutes les quelques secondes, même sur un plateau.
 *
 * Module pur : ni Bluetooth, ni Vue, ni horloge. On lui donne des nombres, il
 * rend des octets — et c'est ce qui permet de vérifier les trames sans machine.
 */

/** Service, et les trois caractéristiques dont on se sert. */
export const FITNESS_MACHINE_SERVICE = 0x1826;
export const FITNESS_MACHINE_FEATURE = 0x2acc;
export const INDOOR_BIKE_DATA = 0x2ad2;
export const FITNESS_MACHINE_CONTROL_POINT = 0x2ad9;

/** Les ordres qu'on émet. */
export const OP_REQUEST_CONTROL = 0x00;
export const OP_RESET = 0x01;
export const OP_SET_SIMULATION = 0x11;
/** Préfixe de toute réponse de la machine. */
export const OP_RESPONSE = 0x80;

/** Les issues d'un ordre, telles que la machine les nomme. */
export const RESULT_SUCCESS = 0x01;
export const RESULT_NOT_SUPPORTED = 0x02;
export const RESULT_INVALID_PARAMETER = 0x03;
export const RESULT_FAILED = 0x04;
export const RESULT_NOT_PERMITTED = 0x05;

/**
 * Pente maximale transmise, en tangente.
 *
 * Le format en accepte trois cents pour cent ; aucune route n'en a. Ce plafond
 * n'est pas une limite de confort — c'est un garde-fou contre une altitude
 * aberrante dans un GPX : un point à 8 000 m au milieu d'une plaine produirait
 * une pente délirante, et la machine la traduirait en mur.
 */
export const MAX_SIMULATED_GRADE = 0.3;

/** Masse volumique de l'air au niveau de la mer, comme dans `physics.js`. */
const RHO_SEA_LEVEL = 1.225;

function clamp(value, low, high) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(high, Math.max(low, value));
}

/**
 * Coefficient de pénétration dans l'air attendu par FTMS, en kg/m.
 *
 * `cw = ½·ρ·CdA` — le même facteur que celui de notre force aérodynamique.
 * L'altitude entre dedans par la densité de l'air : en altitude, la machine
 * doit opposer moins de vent, comme la route.
 *
 * @param {number} CdA traînée × surface frontale, en m².
 * @param {number} [rho] masse volumique de l'air.
 */
export function windCoefficient(CdA, rho = RHO_SEA_LEVEL) {
  const cda = Number.isFinite(CdA) && CdA > 0 ? CdA : 0;
  const density = Number.isFinite(rho) && rho > 0 ? rho : RHO_SEA_LEVEL;
  return 0.5 * density * cda;
}

/**
 * Trame « Set Indoor Bike Simulation Parameters ».
 *
 * @param {Object} params
 * @param {number} params.grade pente en **tangente** (0,08 = 8 %), comme
 *        `RoutePath.gradeAt`. La conversion en pourcents se fait ici, une fois.
 * @param {number} [params.windMs] vent de face, en m/s. Positif de face.
 * @param {number} [params.Crr] résistance au roulement.
 * @param {number} [params.cw] coefficient de pénétration, en kg/m —
 *        cf. `windCoefficient`.
 * @returns {Uint8Array} sept octets, prêts à écrire.
 */
export function encodeSimulation({ grade = 0, windMs = 0, Crr = 0.005, cw = 0.196 } = {}) {
  const frame = new DataView(new ArrayBuffer(7));
  frame.setUint8(0, OP_SET_SIMULATION);
  frame.setInt16(1, Math.round(clamp(windMs, -32, 32) * 1000), true);
  // Tangente → pourcents (×100), puis résolution de 0,01 (×100).
  frame.setInt16(
    3,
    Math.round(clamp(grade, -MAX_SIMULATED_GRADE, MAX_SIMULATED_GRADE) * 10000),
    true
  );
  frame.setUint8(5, Math.round(clamp(Crr, 0, 0.0255) * 10000));
  frame.setUint8(6, Math.round(clamp(cw, 0, 2.55) * 100));
  return new Uint8Array(frame.buffer);
}

/** Trame « Request Control » — sans elle, tout le reste est refusé. */
export function encodeRequestControl() {
  return new Uint8Array([OP_REQUEST_CONTROL]);
}

/**
 * Trame « Reset ».
 *
 * Elle rend la machine à elle-même : la résistance repasse sous son propre
 * contrôle. C'est ce qu'on envoie en quittant, pour ne pas laisser un
 * home-trainer bloqué sur la dernière pente de la séance.
 */
export function encodeReset() {
  return new Uint8Array([OP_RESET]);
}

/**
 * Lit une réponse du point de commande.
 *
 * @param {DataView} view
 * @returns {{requestOp:number, result:number, ok:boolean}|null} `null` si ce
 *          n'est pas une réponse — la caractéristique porte aussi d'autres
 *          indications, qui ne nous concernent pas.
 */
export function parseControlResponse(view) {
  if (!view || view.byteLength < 3) return null;
  if (view.getUint8(0) !== OP_RESPONSE) return null;
  const requestOp = view.getUint8(1);
  const result = view.getUint8(2);
  return { requestOp, result, ok: result === RESULT_SUCCESS };
}

/**
 * Lit la caractéristique « Fitness Machine Feature » (0x2ACC).
 *
 * Huit octets : deux mots de trente-deux bits. Le second décrit ce que la
 * machine accepte qu'on lui **impose**, et c'est le seul qui nous intéresse. On
 * le lit pour ne pas écrire dans le vide : un capteur de puissance qui publie
 * FTMS sans savoir simuler existe, et il refuserait poliment chaque trame.
 *
 * @param {DataView} view
 * @returns {{simulation:boolean, resistance:boolean, power:boolean}}
 */
export function parseFeature(view) {
  if (!view || view.byteLength < 8) return { simulation: false, resistance: false, power: false };
  const target = view.getUint32(4, true);
  return {
    resistance: !!(target & (1 << 2)),
    power: !!(target & (1 << 3)),
    simulation: !!(target & (1 << 13)),
  };
}

/*
 * Indoor Bike Data (0x2AD2) : même principe que Cycling Power, mêmes pièges.
 * Chaque drapeau présent décale les suivants, donc aucun décalage n'est
 * connu d'avance. Et un drapeau est inversé — cf. `MORE_DATA` ci-dessous.
 */
const BIKE_FIELDS = [
  { bit: 1, bytes: 2 }, // vitesse moyenne
  { bit: 2, bytes: 2, key: 'cadenceRpm', scale: 0.5 }, // cadence instantanée, ½ tr/min
  { bit: 3, bytes: 2 }, // cadence moyenne
  { bit: 4, bytes: 3 }, // distance totale (uint24)
  { bit: 5, bytes: 2 }, // niveau de résistance
  { bit: 6, bytes: 2, key: 'powerW', signed: true }, // puissance instantanée
  { bit: 7, bytes: 2 }, // puissance moyenne
  { bit: 8, bytes: 5 }, // énergie dépensée
  { bit: 9, bytes: 1 }, // fréquence cardiaque
  { bit: 10, bytes: 1 }, // équivalent métabolique
  { bit: 11, bytes: 2 }, // temps écoulé
  { bit: 12, bytes: 2 }, // temps restant
];

/**
 * Le bit 0 ne dit pas « vitesse présente » mais « **d'autres données suivent** » :
 * la vitesse instantanée est là quand il vaut zéro. C'est contre-intuitif, c'est
 * conforme, et le lire à l'envers décale tout le reste de la trame.
 */
const MORE_DATA = 1 << 0;

/**
 * Décode une trame Indoor Bike Data.
 *
 * Sert de repli quand la machine ne publie pas Cycling Power : certaines ne
 * parlent que FTMS, et un home-trainer muet parce qu'on n'a interrogé qu'un
 * service est une panne pénible à diagnostiquer.
 *
 * @param {DataView} view
 * @returns {{speedMs:number|null, cadenceRpm:number|null, powerW:number|null}}
 */
export function parseIndoorBikeData(view) {
  if (!view || view.byteLength < 2) throw new Error('trame Indoor Bike Data trop courte');

  const flags = view.getUint16(0, true);
  let offset = 2;
  const out = { speedMs: null, cadenceRpm: null, powerW: null };

  if (!(flags & MORE_DATA)) {
    if (offset + 2 > view.byteLength) return out;
    // Centièmes de km/h → m/s.
    out.speedMs = (view.getUint16(offset, true) * 0.01) / 3.6;
    offset += 2;
  }

  for (const field of BIKE_FIELDS) {
    if (!(flags & (1 << field.bit))) continue;
    if (field.key && offset + field.bytes <= view.byteLength) {
      const raw = field.signed
        ? view.getInt16(offset, true)
        : view.getUint16(offset, true);
      out[field.key] = field.scale ? raw * field.scale : raw;
    }
    offset += field.bytes;
    if (offset > view.byteLength) break;
  }

  return out;
}

/** Écart de pente en deçà duquel une écriture n'apprend rien à la machine. */
export const GRADE_EPSILON = 0.002; // 0,2 %
/** Rythme maximal des écritures : au-delà, la file BLE déborde. */
export const MIN_WRITE_INTERVAL_MS = 250;
/** Rythme minimal : l'autorisation de commande expire après une minute d'inaction. */
export const KEEPALIVE_INTERVAL_MS = 5000;

/**
 * Décide **quand** écrire la pente, sans rien écrire lui-même.
 *
 * Deux échecs symétriques à éviter, et c'est tout l'objet de ce petit organe :
 *
 * - écrire à chaque image **noie la liaison** — une écriture BLE prend des
 *   dizaines de millisecondes, la file s'allonge, et la machine finit par
 *   appliquer une pente vieille de plusieurs secondes, c'est-à-dire fausse ;
 * - n'écrire que sur changement **perd l'autorisation** : une longue ligne
 *   droite plate ne produit aucune trame, et au bout d'une minute la machine
 *   cesse d'obéir. On repasse alors en côte sans résistance, ce qui se sent
 *   immédiatement et ne se comprend pas du tout.
 *
 * Fonction pure du temps qu'on lui donne : elle se teste sans horloge et sans
 * machine.
 */
export function createGradeWriter({
  epsilon = GRADE_EPSILON,
  minIntervalMs = MIN_WRITE_INTERVAL_MS,
  keepAliveMs = KEEPALIVE_INTERVAL_MS,
} = {}) {
  let lastGrade = null;
  let lastWriteMs = -Infinity;

  return {
    /** Dernière pente effectivement transmise, en tangente. `null` avant la première. */
    get grade() {
      return lastGrade;
    },
    reset() {
      lastGrade = null;
      lastWriteMs = -Infinity;
    },
    /**
     * @param {number} grade pente visée, en tangente.
     * @param {number} nowMs horloge de l'appelant.
     * @returns {boolean} vrai s'il faut écrire maintenant — l'appelant confirme
     *          alors par `commit`, pour que le rythme compte les écritures
     *          réellement parties et non celles qu'on a voulues.
     */
    shouldWrite(grade, nowMs) {
      if (!Number.isFinite(grade)) return false;
      if (nowMs - lastWriteMs < minIntervalMs) return false;
      if (lastGrade == null) return true;
      if (Math.abs(grade - lastGrade) >= epsilon) return true;
      return nowMs - lastWriteMs >= keepAliveMs;
    },
    /** Enregistre une écriture partie. */
    commit(grade, nowMs) {
      lastGrade = grade;
      lastWriteMs = nowMs;
    },
  };
}
