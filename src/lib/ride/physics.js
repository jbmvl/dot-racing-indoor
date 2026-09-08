/*
 * physics — des watts, une pente, une vitesse.
 * ---------------------------------------------------------------------
 *
 * ## Pourquoi ce n'est pas le modèle de Dot Racing
 *
 * Dot Racing résout, à chaque tick de cinq secondes, la **vitesse d'équilibre**
 * : la vitesse à laquelle la puissance du coureur égale exactement les
 * résistances. C'est le bon calcul pour une simulation qui avance par tranches
 * — sur cinq secondes, un cycliste a le temps d'atteindre son régime.
 *
 * Ici, on rend soixante images par seconde et le joueur pédale en direct.
 * Poser la vitesse d'équilibre à chaque image donnerait un vélo sans masse :
 * on met 300 W, la vitesse saute instantanément ; on relâche, elle s'effondre.
 * Or **c'est l'inertie qui fait qu'une séance se sent** — la relance qui coûte,
 * l'élan qu'on garde en haut d'une bosse, la vitesse qui monte encore quelques
 * secondes après le sommet.
 *
 * On intègre donc les forces :
 *
 *     a = (F_pédale − F_aéro − F_roulement − F_gravité) / m
 *     v ← v + a·dt
 *
 * La vitesse d'équilibre reste ici, mais comme **référence de test** : au
 * repos, l'intégrateur doit y converger. C'est ce qui garantit qu'on a intégré
 * les bonnes forces, et pas seulement des forces plausibles.
 *
 * ## Le point délicat : la force à l'arrêt
 *
 * `F = P / v` explose quand `v → 0`. Ce n'est pas un artefact de calcul, c'est
 * la limite du modèle : à l'arrêt, un cycliste n'est pas limité par sa
 * puissance mais par le couple qu'il peut mettre sur les pédales, et par
 * l'adhérence. On plafonne donc la vitesse au dénominateur — en dessous,
 * c'est une force constante qui s'applique, ce qui donne un démarrage franc
 * sans être explosif.
 *
 * Module pur : pas de Vue, pas d'horloge, pas d'état global.
 */

export const GRAVITY = 9.81;
/** Masse volumique de l'air au niveau de la mer, à 15 °C. */
export const AIR_DENSITY_SEA_LEVEL = 1.225;

/**
 * Force maximale à la roue, en newtons.
 *
 * `F = P/v` diverge quand `v → 0`, et il faut bien borner quelque chose. La
 * tentation est de plafonner la **vitesse au dénominateur** — « en dessous de
 * 1,5 m/s, on fait comme si on roulait à 1,5 m/s ». C'est faux, et d'une façon
 * qui ne se voit pas tout de suite : cela plafonne du même coup la force à
 * `P/1,5`, et interdit donc les régimes lents qui sont précisément la solution
 * dans les pentes raides. 100 W à 10 % s'équilibrent à 4 km/h ; avec un tel
 * plancher, le modèle répond « pente insurmontable ».
 *
 * On borne donc la **force**, ce qui est la vraie limite physique — le couple
 * sur les pédales et l'adhérence. 400 N est un appui franc, en danseuse. Le
 * plafond ne mord qu'au démarrage, en dessous de 0,5 m/s à 200 W.
 */
export const MAX_TRACTION_N = 400;

/** Sous cette vitesse, la division n'est plus fiable ; le plafond prend le relais. */
const TRACTION_EPSILON_MS = 0.1;

/**
 * Force disponible à la roue pour une puissance et une vitesse données.
 *
 * Une seule définition, partagée par l'intégrateur et par le solveur
 * d'équilibre : s'ils divergeaient ici, le test qui vérifie que le premier
 * converge vers le second ne vérifierait plus rien.
 */
export function tractionForce(powerW, speedMs) {
  const power = Number.isFinite(powerW) && powerW > 0 ? powerW : 0;
  if (power === 0) return 0;
  return Math.min(power / Math.max(speedMs, TRACTION_EPSILON_MS), MAX_TRACTION_N);
}

/**
 * Réglages par défaut. Ce sont des valeurs de cycliste ordinaire sur un vélo de
 * route : elles ne prétendent pas décrire quelqu'un en particulier, elles
 * donnent un point de départ crédible.
 */
export const DEFAULT_SETUP = {
  /** Masse du coureur, en kilogrammes. */
  riderKg: 75,
  /** Masse du vélo et de son équipement. */
  bikeKg: 8,
  /** Coefficient de traînée × surface frontale, en m². Mains sur les cocottes. */
  CdA: 0.32,
  /** Résistance au roulement, pneus de route sur bitume sec. */
  Crr: 0.005,
};

/**
 * Masse volumique de l'air à une altitude donnée (modèle barométrique
 * standard). À 2 000 m, l'air est un cinquième moins dense : un col se descend
 * sensiblement plus vite qu'une côte de même pente au bord de la mer.
 */
export function airDensity(altitudeM = 0) {
  if (!Number.isFinite(altitudeM)) return AIR_DENSITY_SEA_LEVEL;
  return AIR_DENSITY_SEA_LEVEL * Math.exp(-altitudeM / 8500);
}

/**
 * Les trois résistances, en newtons, à une vitesse donnée.
 *
 * @param {Object} params
 * @param {number} params.speedMs vitesse au sol.
 * @param {number} params.grade pente en **tangente** (0,08 = 8 %), comme
 *        `RoutePath.gradeAt`. Positive en montée.
 * @param {number} params.massKg masse totale, coureur et vélo.
 * @param {number} params.CdA
 * @param {number} params.Crr
 * @param {number} [params.rho] masse volumique de l'air.
 * @param {number} [params.windMs] vent de face, positif. Un vent arrière est négatif.
 * @returns {{aero:number, rolling:number, gravity:number, total:number}}
 */
export function resistanceForces({
  speedMs,
  grade = 0,
  massKg,
  CdA,
  Crr,
  rho = AIR_DENSITY_SEA_LEVEL,
  windMs = 0,
}) {
  const angle = Math.atan(grade);
  const relative = speedMs + windMs;
  return {
    // `|vRel|·vRel` et non `vRel²` : par vent arrière plus rapide que le
    // coureur, l'air pousse au lieu de freiner, et le signe doit suivre.
    aero: 0.5 * rho * CdA * Math.abs(relative) * relative,
    rolling: Crr * massKg * GRAVITY * Math.cos(angle),
    gravity: massKg * GRAVITY * Math.sin(angle),
    get total() {
      return this.aero + this.rolling + this.gravity;
    },
  };
}

/**
 * Vitesse d'équilibre : celle à laquelle la puissance égale les résistances.
 *
 * Résolue par dichotomie plutôt que par Newton-Raphson. C'est un peu plus lent
 * — une trentaine d'itérations au lieu de cinq — mais cela ne s'appelle jamais
 * dans une boucle de rendu, et surtout la dichotomie **converge toujours** sur
 * un intervalle encadrant, là où Newton-Raphson diverge en descente raide et
 * demande une batterie de garde-fous. Dot Racing en porte une demi-douzaine ;
 * on n'en a besoin d'aucun.
 *
 * @returns {number} vitesse en m/s. Zéro quand la pente est insurmontable.
 */
export function steadyStateSpeed({
  powerW,
  grade = 0,
  massKg = DEFAULT_SETUP.riderKg + DEFAULT_SETUP.bikeKg,
  CdA = DEFAULT_SETUP.CdA,
  Crr = DEFAULT_SETUP.Crr,
  rho = AIR_DENSITY_SEA_LEVEL,
  windMs = 0,
  altitudeM = null,
} = {}) {
  const density = altitudeM == null ? rho : airDensity(altitudeM);
  const power = Number.isFinite(powerW) && powerW > 0 ? powerW : 0;
  const forces = (v) => resistanceForces({ speedMs: v, grade, massKg, CdA, Crr, rho: density, windMs }).total;

  // `net(v)` est la force qui reste pour accélérer. Elle décroît avec la
  // vitesse — l'aéro croît en v², la traction en 1/v — donc elle change de
  // signe une seule fois : la dichotomie est exacte.
  const net = (v) => tractionForce(power, v) - forces(v);

  // Un coureur qui ne pédale pas dans une côte s'arrête ; en descente il
  // accélère quand même. La force disponible à l'arrêt tranche les deux cas.
  if (net(0) <= 0) return 0;

  let low = 0;
  let high = 40; // 144 km/h : au-delà, ce n'est plus du vélo.
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (net(mid) > 0) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/**
 * L'intégrateur : ce qui tourne à chaque image.
 *
 * @param {Object} [setup] fusionné avec `DEFAULT_SETUP`.
 * @returns un objet avec `advance(deltaS, {powerW, grade, windMs, altitudeM})`
 *          et une `speedMs` en lecture.
 */
export function createSpeedIntegrator(setup = {}) {
  const config = { ...DEFAULT_SETUP, ...setup };
  let speed = 0;

  return {
    get speedMs() {
      return speed;
    },
    get massKg() {
      return config.riderKg + config.bikeKg;
    },
    /** Change le gabarit en cours de séance, sans perdre l'élan. */
    configure(next = {}) {
      Object.assign(config, next);
    },
    reset(speedMs = 0) {
      speed = Number.isFinite(speedMs) && speedMs > 0 ? speedMs : 0;
    },

    /**
     * @param {number} deltaS secondes écoulées.
     * @param {Object} input
     * @param {number} input.powerW puissance aux pédales.
     * @param {number} [input.grade] pente en tangente.
     * @param {number} [input.windMs] vent de face.
     * @param {number} [input.altitudeM] pour la densité de l'air.
     * @returns {number} la nouvelle vitesse, en m/s.
     */
    advance(deltaS, { powerW = 0, grade = 0, windMs = 0, altitudeM = null } = {}) {
      if (!(deltaS > 0)) return speed;
      const massKg = config.riderKg + config.bikeKg;
      const rho = altitudeM == null ? AIR_DENSITY_SEA_LEVEL : airDensity(altitudeM);
      const power = Number.isFinite(powerW) && powerW > 0 ? powerW : 0;

      /*
       * Une longue image — onglet revenu au premier plan, garbage collector —
       * intégrée d'un bloc ferait franchir l'équilibre et osciller. On la
       * découpe en pas dont la durée reste petite devant le temps de réponse du
       * système (quelques secondes) : la stabilité ne dépend alors plus de la
       * cadence d'affichage.
       */
      const steps = Math.max(1, Math.ceil(deltaS / 0.05));
      const dt = deltaS / steps;

      for (let i = 0; i < steps; i++) {
        const traction = tractionForce(power, speed);
        const resistance = resistanceForces({
          speedMs: speed,
          grade,
          massKg,
          CdA: config.CdA,
          Crr: config.Crr,
          rho,
          windMs,
        }).total;
        speed += ((traction - resistance) / massKg) * dt;
        // Un vélo ne recule pas. La gravité peut l'y pousser dans un mur, mais
        // ce n'est plus une séance : on s'arrête.
        if (speed < 0) speed = 0;
      }

      return speed;
    },
  };
}
