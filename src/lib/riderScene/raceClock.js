/*
 * raceClock — l'horloge de course : du temps réel au temps de jeu.
 * ---------------------------------------------------------------------
 *
 * **Côté jeu.** Rien ici n'est géographique : c'est la lecture du flux d'états
 * diffusé par le moteur de course. Le générateur de décor n'en a aucun besoin
 * — il reçoit un point, pas un historique.
 *
 * ## Pourquoi une horloge et non un rejeu par tranches
 *
 * L'ancien module (`pathTween`) tenait pour acquis qu'une diffusion valait une
 * tranche de `ROUND_DURATION_MS`, rejouée en cinq secondes, toujours. C'est
 * faux : `raceService` fait avancer la course de **N rounds d'affilée** selon
 * son retard, et la durée d'un round elle-même varie (5 s, 30 s en turbo, et
 * une durée progressive quand le retard s'accumule). Une diffusion peut donc
 * couvrir cinq secondes de course, ou quarante. Les rejouer toutes en cinq
 * secondes, c'est la cause directe des sprints suivis d'attentes.
 *
 * Ce que le moteur diffuse réellement, c'est un couple daté :
 *
 *     (race.lastUpdate, lastDistanceItinerary)   →   d(t)
 *
 * une **fonction de la distance parcourue par le temps de jeu**, pas une suite
 * de segments. Ce module la lit comme telle.
 *
 * ## Deux organes, deux responsabilités
 *
 * 1. **L'horloge** (`createRaceClock`) va du temps réel au temps de jeu. Elle
 *    avance *toujours*, jamais à reculons, à un taux asservi sur son retard :
 *
 *        cible = t_du_dernier_échantillon − retard
 *        taux  = 1 + (cible − t_lu) / τ,   borné
 *
 *    Le taux normal reste dans ±15 % : à cette amplitude un changement de
 *    vitesse ne se voit pas, là où un saut se voit toujours. La borne haute
 *    s'ouvre (jusqu'à ×3) quand le retard devient franc — un rattrapage de
 *    course — et l'horloge ne se repose d'un bloc qu'au-delà de cinq minutes
 *    d'écart, ce qui n'arrive qu'au retour d'un onglet laissé de côté.
 *
 *    Quand le flux se tarit, l'horloge ne se fige pas : elle continue jusqu'à
 *    `maxAheadS` au-delà du dernier échantillon connu, et la distance, elle,
 *    prolonge à la dernière vitesse connue puis ralentit jusqu'à l'arrêt. Le
 *    coureur ne s'immobilise donc jamais d'un coup — sauf quand il est
 *    réellement à l'arrêt, ce que la participation dit (`moving: false`).
 *
 * 2. **Le suiveur** (`createDistanceFollower`) va du temps de jeu à la distance
 *    rendue. La chronologie est linéaire par morceaux : sa pente casse à chaque
 *    échantillon. Deux boucles emboîtées — l'écart de position fixe un surplus
 *    de vitesse borné, la vitesse rejoint sa consigne à accélération bornée —
 *    absorbent ces ruptures sans retard permanent sur une rampe, et **ne
 *    reculent jamais** (vitesse gardée positive). C'est lui qui garantit la
 *    continuité de ce qu'on voit, quelles que soient les bêtises du flux.
 *
 * Module pur : ni three.js, ni Vue, ni horloge propre. L'appelant fournit le
 * temps écoulé, ce qui rend tout ceci testable.
 */

/** Écart signé le plus court entre deux caps, dans `]-180, 180]`. */
export function shortestAngleDelta(from, to) {
  let delta = (to - from) % 360;
  if (delta > 180) delta -= 360;
  if (delta <= -180) delta += 360;
  return delta;
}

/** Ramène un cap dans `[0, 360[`. */
export function normalizeBearing(bearing) {
  const value = Number.isFinite(bearing) ? bearing : 0;
  return ((value % 360) + 360) % 360;
}

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const clamp01 = (value) => clamp(value, 0, 1);

/** Un degré de latitude, en mètres — la Terre à l'échelle qui nous occupe. */
const METERS_PER_DEGREE = 111320;

/** Point situé `meters` en arrière d'une position, selon son cap. */
function behind(lng, lat, bearingDeg, meters) {
  const angle = (Number(bearingDeg) || 0) * (Math.PI / 180);
  const cosLat = Math.max(0.01, Math.cos(lat * (Math.PI / 180)));
  return {
    lng: lng - (Math.sin(angle) * meters) / (METERS_PER_DEGREE * cosLat),
    lat: lat - (Math.cos(angle) * meters) / METERS_PER_DEGREE,
  };
}

export const CLOCK_DEFAULTS = {
  /**
   * Retard de lecture, en multiple de l'intervalle observé entre deux
   * diffusions. Au-dessus de 1, la lecture reste dans la partie **interpolée**
   * de la chronologie : ce qu'elle montre est acquis, plus rien ne viendra le
   * contredire.
   */
  lagFactor: 1.25,
  minLagS: 4,
  maxLagS: 45,
  /**
   * Cadence supposée des diffusions tant qu'on n'en a pas observé une, en
   * secondes de jeu. Le pas de simulation nominal du moteur convient : sans
   * elle, la lecture partirait avec un retard trop court et passerait sa
   * première demi-minute à 12 % sous la vitesse réelle, le temps de le creuser.
   */
  expectedGapS: 5,
  /** Constante de résorption de l'écart. 20 s : 3 s d'écart → 15 % de taux. */
  tauS: 20,
  /** Écart de taux toléré en marche normale. ±15 % ne se voit pas. */
  softDev: 0.15,
  /** Ouverture supplémentaire de la borne haute, en rattrapage franc. */
  hardDev: 2,
  softErrS: 15,
  hardErrS: 75,
  /** Au-delà, l'horloge se repose : onglet resté en arrière-plan, rejeu. */
  reseatErrS: 300,
  /** Avance maximale au-delà du dernier échantillon, quand le flux se tarit. */
  maxAheadS: 15,
  /** Prolongation à vitesse pleine, puis décélération sur la même durée. */
  holdS: 6,
  fadeS: 6,
  /** Profondeur d'historique gardée, en secondes de jeu. */
  historyS: 180,
  /** Au-delà, la distance a été renumérotée, pas parcourue. */
  maxRebaseSpeedMs: 45,
  /** Recul de distance toléré (arrondis serveur) avant de tout réancrer. */
  maxRollbackM: 5,
  /**
   * Longueur de l'échantillon fictif posé en amont au démarrage, quand on
   * connaît déjà la vitesse du coureur. Sans lui, la lecture reste immobile
   * jusqu'à la deuxième diffusion — les fameuses dix secondes de statue.
   */
  seedSpanS: 10,
};

/**
 * Chronologie + horloge de lecture.
 *
 * @param {Object} [options] cf. `CLOCK_DEFAULTS`.
 * @param {Function} [options.onEvent] journal de diagnostic — cf. `motionDiagnostics.js`.
 */
export function createRaceClock(options = {}) {
  const config = { ...CLOCK_DEFAULTS, ...options };
  const onEvent = typeof options.onEvent === 'function' ? options.onEvent : null;

  /** @type {Array<{t:number,d:number|null,lng:number,lat:number,bearing:number,moving:boolean}>} */
  let samples = [];
  let gapS = null;
  let tPlay = 0;
  let rate = 1;
  let starving = false;
  /**
   * Temps réel écoulé depuis le montage, en secondes — l'appelant nous le donne
   * par `advance()`. Il ne sert qu'à dater les arrivées quand le moteur ne les
   * date pas lui-même, ce qui arrive plus souvent qu'on ne l'aimerait.
   */
  let realNow = 0;
  /**
   * Dernière heure de moteur réellement annoncée. C'est elle — et non la
   * chronologie, qui peut avoir été datée sur le temps réel — qui sert à mesurer
   * l'avance du moteur et à reconnaître un vrai recul.
   */
  let lastClaimed = null;

  const notify = (event) => {
    if (onEvent) onEvent(event);
  };

  const latest = () => (samples.length ? samples[samples.length - 1] : null);

  /** Retard de lecture visé, tiré de la cadence observée. */
  function lagS() {
    const base = gapS == null ? config.minLagS : gapS * config.lagFactor;
    return clamp(base, config.minLagS, config.maxLagS);
  }

  function trim() {
    const last = latest();
    if (!last) return;
    const floor = last.t - config.historyS;
    // On garde toujours au moins deux échantillons : ce sont eux qui portent la
    // pente, donc la vitesse.
    while (samples.length > 2 && samples[1].t < floor) samples.shift();
  }

  /** Repart de zéro sur cet échantillon, en oubliant tout le reste. */
  function seat(sample, speedMs) {
    samples = [sample];
    gapS = config.expectedGapS;
    tPlay = sample.t;
    rate = 1;
    starving = false;

    // Amorce : un échantillon fictif en amont, tiré de la vitesse annoncée par
    // le moteur. La lecture peut alors partir tout de suite, à la bonne
    // vitesse, au lieu d'attendre la diffusion suivante pour connaître une
    // pente. Il n'invente pas la trajectoire — seulement l'allure.
    const v = Number(speedMs);
    if (Number.isFinite(v) && v > 0.3 && sample.moving) {
      const span = config.seedSpanS;
      // Position reculée le long du cap, et pas simplement recopiée : sans
      // cela, la lecture sans tracé — repli en droit, autre coureur, itinéraire
      // fraîchement recalculé dont la trace commence ici — interpolerait entre
      // deux points identiques et resterait immobile le temps du retard.
      const back = sample.hasBearing
        ? behind(sample.lng, sample.lat, sample.bearing, v * span)
        : { lng: sample.lng, lat: sample.lat };
      samples.unshift({
        t: sample.t - span,
        // Sans distance diffusée (un autre coureur), l'amorce n'en invente pas :
        // c'est la position reculée qui porte le mouvement.
        d: Number.isFinite(sample.d) ? sample.d - v * span : null,
        lng: back.lng,
        lat: back.lat,
        bearing: sample.bearing,
        moving: true,
        seeded: true,
      });
      // Le retard de lecture est installé **tout de suite**, à son plancher : le
      // laisser se creuser tout seul coûterait quarante secondes de lecture à
      // 85 % de la vitesse réelle, le temps que le taux le rattrape. La lecture
      // démarre donc là où le coureur se trouvait il y a quatre secondes — ce
      // qui ne se voit pas au montage, puisqu'il n'y a pas d'avant.
      tPlay = sample.t - Math.min(span, lagS());
    }
  }

  return {
    /** Instant de lecture, en secondes de jeu. */
    get time() {
      return tPlay;
    },
    /** Taux de lecture de la dernière image : 1 = temps réel. */
    get rate() {
      return rate;
    },
    get sampleCount() {
      return samples.length;
    },
    get lastSample() {
      return latest();
    },
    /** Retard de lecture visé, en secondes de jeu. */
    get lagS() {
      return lagS();
    },
    /** Secondes de jeu lues au-delà du dernier échantillon connu. */
    get aheadS() {
      const last = latest();
      return last ? Math.max(0, tPlay - last.t) : 0;
    },
    /** Vrai tant que la lecture est sortie de la chronologie connue. */
    get starving() {
      return starving;
    },
    /**
     * Vrai quand le dernier état portait une heure de moteur exploitable. Faux,
     * la chronologie est datée sur le temps réel écoulé — la lecture reste
     * juste, mais elle ne peut plus reconnaître un rattrapage de course.
     */
    get dated() {
      const last = latest();
      return !!last && last.dated !== false;
    },

    /** Vide tout : changement de coureur, démontage. */
    reset() {
      samples = [];
      gapS = null;
      tPlay = 0;
      rate = 1;
      starving = false;
      lastClaimed = null;
    },

    /**
     * Soumet un état diffusé par le moteur.
     *
     * @param {Object} sample
     * @param {number} sample.t        temps de jeu (`race.lastUpdate`), en secondes.
     * @param {number|null} sample.d   distance sur l'itinéraire, en mètres.
     * @param {number} sample.lng
     * @param {number} sample.lat
     * @param {number} [sample.bearing] cap moyen du moteur.
     * @param {boolean} [sample.moving] faux quand le coureur est réellement à
     *        l'arrêt (pause, avant le départ, course quittée) : la lecture ne
     *        prolonge alors aucun mouvement.
     * @param {number} [speedMs] vitesse connue, utilisée seulement à l'amorce.
     * @returns {'seated'|'queued'|'rebased'|'merged'|'ignored'}
     */
    push(sample, speedMs = null) {
      const lng = Number(sample?.lng);
      const lat = Number(sample?.lat);
      const d = Number.isFinite(sample?.d) ? Number(sample.d) : null;
      const moving = sample?.moving !== false;
      // Un cap absent n'est pas un cap au nord : sans lui, l'amorce ne peut pas
      // reculer la position de départ, et se contente de la recopier.
      const hasBearing = Number.isFinite(sample?.bearing);
      const bearing = normalizeBearing(sample?.bearing);
      const last = latest();

      /*
       * Datation de l'état. Le temps de jeu (`race.lastUpdate`) est la seule
       * mesure qui dise **combien de course** un état couvre : c'est elle qu'on
       * veut. Mais il arrive qu'elle n'avance pas — un delta SSE qui ne la
       * transporte pas, un client qui ne la rafraîchit qu'au full-state —, et
       * une chronologie qui n'avance pas est une chronologie morte : la lecture
       * sort de son domaine, la vitesse tombe à zéro et le coureur rampe.
       *
       * On retombe donc sur le seul temps dont on soit sûr : celui qui s'est
       * réellement écoulé depuis l'arrivée précédente. Le repli est fidèle tant
       * que la course tourne en temps réel — ce qui est le cas normal — et perd
       * seulement la capacité de reconnaître un rattrapage.
       */
      const claimed = Number(sample?.t);
      const usable = Number.isFinite(claimed) && claimed > 0;
      let t;
      let dated = usable;
      if (!last) {
        t = usable ? claimed : 0;
      } else if (usable && claimed > lastClaimed) {
        // Le moteur avance : on reporte **son incrément**, pas sa valeur. La
        // chronologie a pu être datée sur le temps réel entre-temps ; repartir
        // de la valeur brute la ferait reculer.
        t = last.t + (claimed - lastClaimed);
      } else if (usable && claimed < lastClaimed - 1) {
        // Le temps de jeu a franchement reculé : remise à zéro de la course,
        // curseur de rejeu, changement de course.
        t = claimed;
      } else {
        t = last.t + Math.max(0.25, realNow - (last.arrivedAt ?? realNow));
        dated = false;
      }

      const report = (verdict, extra = null) => {
        notify({
          type: 'arrival',
          verdict,
          t,
          d,
          lng,
          lat,
          moving,
          dated,
          gapS,
          lagS: lagS(),
          behindS: latest() ? latest().t - tPlay : 0,
          ...extra,
        });
        return verdict;
      };

      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return report('ignored');

      const entry = { t, d, lng, lat, bearing, hasBearing, moving, dated, arrivedAt: realNow };

      if (!last) {
        lastClaimed = usable ? claimed : null;
        seat(entry, speedMs);
        return report('seated');
      }

      // Le temps de jeu a reculé pour de bon : rien à raccorder.
      if (usable && claimed < lastClaimed - 1) {
        lastClaimed = claimed;
        seat(entry, speedMs);
        return report('rebased');
      }

      // État strictement identique au précédent : rien n'a bougé, on remplace
      // plutôt que d'empiler un intervalle qui ne porte aucun mouvement — et on
      // lui garde sa date, sinon la chronologie s'étirerait sans avancer.
      if (lng === last.lng && lat === last.lat && d === last.d) {
        t = last.t;
        samples[samples.length - 1] = { ...entry, t, arrivedAt: last.arrivedAt };
        return report('merged');
      }

      if (Number.isFinite(d) && Number.isFinite(last.d)) {
        const step = d - last.d;
        // La distance recule, ou bondit hors d'échelle : elle a été renumérotée
        // (itinéraire recalculé), pas parcourue. On ne peut pas raccorder deux
        // abscisses qui ne parlent pas du même tracé.
        if (step < -config.maxRollbackM || step / (t - last.t) > config.maxRebaseSpeedMs) {
          if (usable) lastClaimed = claimed;
          seat(entry, speedMs);
          return report('rebased', { step });
        }
      }

      // Cadence observée. Une coupure de flux n'est pas une cadence : au-delà du
      // retard maximal, l'écart n'est plus une période de diffusion mais une
      // panne, et l'intégrer gonflerait le retard de lecture pour longtemps.
      const gap = t - last.t;
      if (gap <= config.maxLagS) gapS = gapS == null ? gap : gapS + (gap - gapS) * 0.3;
      if (usable) lastClaimed = claimed;
      samples.push(entry);
      trim();
      return report('queued');
    },

    /**
     * Fait avancer l'horloge de `deltaS` secondes **réelles**.
     * @returns {{time:number, rate:number, reseated:boolean}}
     */
    advance(deltaS) {
      if (deltaS > 0) realNow += deltaS;
      const last = latest();
      if (!last || !(deltaS > 0)) return { time: tPlay, rate, reseated: false };

      const target = last.t - lagS();
      const error = target - tPlay;
      let reseated = false;

      if (error > config.reseatErrS) {
        // Onglet revenu au premier plan après plusieurs minutes : rattraper en
        // parcourant ferait traverser la scène pendant une minute.
        tPlay = target;
        rate = 1;
        notify({ type: 'reseat', t: tPlay, error });
        reseated = true;
      } else {
        const opening =
          config.hardDev *
          clamp01((error - config.softErrS) / Math.max(1, config.hardErrS - config.softErrS));
        rate = clamp(1 + error / config.tauS, 1 - config.softDev, 1 + config.softDev + opening);
        tPlay += deltaS * rate;
      }

      // Le flux s'est tari : la lecture continue un moment au-delà du dernier
      // état connu — c'est ce qui remplace l'ancien arrêt net — puis s'arrête
      // d'avancer dans le temps. La distance, elle, a déjà fini de ralentir.
      const ceiling = last.t + config.maxAheadS;
      if (tPlay > ceiling) tPlay = ceiling;
      if (tPlay < samples[0].t) tPlay = samples[0].t;

      const wasStarving = starving;
      starving = tPlay > last.t;
      if (starving && !wasStarving) notify({ type: 'starving', t: tPlay, aheadS: tPlay - last.t });
      if (!starving && wasStarving) notify({ type: 'resume', t: tPlay });

      return { time: tPlay, rate, reseated };
    },

    /**
     * Distance parcourue à cet instant de jeu, et sa dérivée.
     *
     * @param {number} [t] par défaut, l'instant de lecture courant.
     * @returns {{d:number, v:number}|null} `v` en mètres par seconde **de jeu** ;
     *          `null` si le moteur n'a jamais diffusé de distance.
     */
    distanceAt(t = tPlay) {
      return interpolate(samples, t, config, (s) => s.d, (a, b, ratio) => a + (b - a) * ratio);
    },

    /**
     * Position à cet instant de jeu — le repli quand il n'y a pas de tracé
     * (les autres coureurs, un itinéraire pas encore chargé).
     * @returns {{lng:number, lat:number, bearing:number}|null}
     */
    positionAt(t = tPlay) {
      if (!samples.length) return null;
      const at = locate(samples, t, config);
      if (!at) return null;
      const { a, b, ratio, extra } = at;

      if (!b) {
        // Prolongation : on continue dans la direction et à l'allure du dernier
        // intervalle connu, sans jamais quitter la carte.
        const previous = samples.length > 1 ? samples[samples.length - 2] : null;
        if (!previous || !a.moving) return { lng: a.lng, lat: a.lat, bearing: a.bearing };
        const span = Math.max(1e-6, a.t - previous.t);
        return {
          lng: a.lng + ((a.lng - previous.lng) / span) * extra,
          lat: a.lat + ((a.lat - previous.lat) / span) * extra,
          bearing: a.bearing,
        };
      }

      return {
        lng: a.lng + (b.lng - a.lng) * ratio,
        lat: a.lat + (b.lat - a.lat) * ratio,
        bearing: normalizeBearing(a.bearing + shortestAngleDelta(a.bearing, b.bearing) * ratio),
      };
    },
  };
}

/**
 * Situe un instant dans la chronologie.
 *
 * @returns {{a:Object, b:Object|null, ratio:number, extra:number}|null} `b` est
 *          nul au-delà du dernier échantillon ; `extra` est alors le nombre de
 *          secondes de jeu de prolongation **déjà pondérées** par la
 *          décélération (plein régime pendant `holdS`, puis extinction
 *          linéaire sur `fadeS`).
 */
function locate(samples, t, config) {
  if (!samples.length) return null;
  const first = samples[0];
  if (t <= first.t) return { a: first, b: samples[1] ?? null, ratio: 0, extra: 0 };

  const last = samples[samples.length - 1];
  if (t >= last.t) {
    const tau = t - last.t;
    const { holdS, fadeS } = config;
    let extra;
    if (tau <= holdS) extra = tau;
    else if (tau <= holdS + fadeS) {
      const over = tau - holdS;
      extra = holdS + over - (over * over) / (2 * fadeS);
    } else extra = holdS + fadeS / 2;
    return { a: last, b: null, ratio: 0, extra };
  }

  let low = 0;
  let high = samples.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (samples[mid].t <= t) low = mid;
    else high = mid;
  }
  const a = samples[low];
  const b = samples[high];
  const span = b.t - a.t;
  return { a, b, ratio: span > 0 ? (t - a.t) / span : 0, extra: 0 };
}

/** Interpolation d'un champ numérique de la chronologie, prolongation comprise. */
function interpolate(samples, t, config, read, blend) {
  if (!samples.length) return null;
  const at = locate(samples, t, config);
  const valueA = read(at.a);
  if (!Number.isFinite(valueA)) return null;

  if (at.b) {
    const valueB = read(at.b);
    if (!Number.isFinite(valueB)) return null;
    const span = Math.max(1e-6, at.b.t - at.a.t);
    return { d: blend(valueA, valueB, at.ratio), v: (valueB - valueA) / span };
  }

  const previous = samples.length > 1 ? samples[samples.length - 2] : null;
  const valueP = previous ? read(previous) : null;
  if (!previous || !Number.isFinite(valueP) || !at.a.moving) return { d: valueA, v: 0 };

  const span = Math.max(1e-6, at.a.t - previous.t);
  const slope = (valueA - valueP) / span;
  const tau = t - at.a.t;
  const remaining = 1 - clamp01((tau - config.holdS) / Math.max(1e-6, config.fadeS));
  return { d: valueA + slope * at.extra, v: slope * remaining };
}

export const FOLLOWER_DEFAULTS = {
  /** Temps de réponse de la vitesse. 0,25 s : une rupture de pente ne se voit pas. */
  tauS: 0.25,
  /**
   * Temps de résorption d'un écart de position. 0,8 s : un mètre de retard
   * s'achète avec 1,25 m/s de vitesse en plus.
   */
  catchTauS: 0.8,
  /** Accélération et freinage maximaux, en m/s². Un cycliste, pas une fusée. */
  maxAccel: 2.5,
  maxDecel: 6,
  /** Surplus de vitesse consenti pour résorber un écart. */
  catchUpFactor: 0.6,
  catchUpFloorMs: 3,
};

/**
 * Le suiveur de distance : du temps de jeu à la distance rendue.
 *
 * Deux boucles emboîtées plutôt qu'un ressort : l'écart de position fixe un
 * **surplus de vitesse**, borné ; ce surplus fixe la vitesse visée ; et la
 * vitesse rejoint sa consigne à accélération bornée. Un ressort du second ordre
 * s'emballerait ici, parce que le limiteur d'accélération laisse l'écart de
 * position se creuser pendant qu'il est saturé — l'emballement classique de
 * l'intégrateur, qui se paie en dépassement puis en oscillation. Saturer au
 * niveau de la vitesse coupe court : rien ne s'accumule.
 *
 * Trois garanties, et c'est tout ce qu'on lui demande : la sortie est
 * continûment dérivable, l'accélération est bornée, et **la vitesse ne devient
 * jamais négative** — le coureur ne peut pas reculer, quoi que raconte le flux.
 * Sur une consigne en rampe — le cas normal — le retard est nul.
 */
export function createDistanceFollower(options = {}) {
  const config = { ...FOLLOWER_DEFAULTS, ...options };
  let d = null;
  let v = 0;

  return {
    get distance() {
      return d;
    },
    /** Vitesse rendue, en m/s. C'est elle qui commande jambes et inclinaison. */
    get speed() {
      return v;
    },

    /** Pose la lecture sans transition (montage, changement de coureur, saut). */
    seat(distance, speed = 0) {
      d = Number.isFinite(distance) ? distance : null;
      v = Number.isFinite(speed) ? Math.max(0, speed) : 0;
    },

    /**
     * @param {number} target  distance visée, en mètres.
     * @param {number} targetV vitesse visée, en m/s **réelles** (pente de la
     *        chronologie multipliée par le taux de l'horloge).
     * @param {number} deltaS  secondes réelles écoulées.
     */
    follow(target, targetV, deltaS) {
      if (!Number.isFinite(target)) return { d, v };
      if (d == null) {
        d = target;
        v = Math.max(0, Number(targetV) || 0);
        return { d, v };
      }
      if (!(deltaS > 0)) return { d, v };

      const wanted = Math.max(0, Number(targetV) || 0);
      const margin = Math.max(config.catchUpFloorMs, wanted * config.catchUpFactor);
      const correction = clamp((target - d) / config.catchTauS, -margin, margin);
      const desired = Math.max(0, wanted + correction);

      const accel = clamp((desired - v) / config.tauS, -config.maxDecel, config.maxAccel);
      v = Math.max(0, v + accel * deltaS);
      d += v * deltaS;
      return { d, v };
    },
  };
}
