/*
 * rideState — où en est le coureur sur son parcours.
 * ---------------------------------------------------------------------
 *
 * C'est ici que se joue la différence de nature avec Dot Racing, et elle vaut
 * d'être écrite noir sur blanc.
 *
 * Dans Dot Racing, le serveur est l'autorité : il diffuse toutes les cinq
 * secondes une position et une abscisse, et le client passe son temps à
 * rattraper ce retard sans que cela se voie — d'où l'horloge de course, le
 * suiveur de distance et l'ancre de tracé. Ici, **le client possède sa propre
 * distance**. Elle avance à chaque image, sous les jambes du joueur. Il n'y a
 * plus rien à rattraper, donc plus rien à lisser : ces trois organes n'ont pas
 * leur place dans ce module, et leur absence est une décision, pas un oubli.
 *
 * Ce que ce module tient, et rien d'autre :
 *
 * | | |
 * |---|---|
 * | `distanceM`      | le compteur : tout ce qui a été parcouru, jamais remis à zéro |
 * | `routeDistanceM` | où l'on est **sur le tracé** — ramené dans ses bornes quand le parcours boucle |
 * | `laps`           | combien de fois on a bouclé |
 *
 * La vitesse ne se décide pas ici : elle est passée à `advance`. Aujourd'hui
 * elle est imposée (L1), demain elle viendra du modèle physique (L3) — et ce
 * module ne changera pas pour autant. C'est tout l'intérêt de ne pas lui faire
 * porter la puissance.
 *
 * Module pur : pas de Vue, pas de three.js, pas d'horloge. Il ne sait pas quel
 * temps il est, on le lui dit.
 */

/**
 * @param {Object} options
 * @param {import('../riderScene/routePath.js').RoutePath} options.path
 * @param {boolean} [options.loop] Le parcours se reboucle sur lui-même.
 * @param {number} [options.startDistanceM] Abscisse de départ sur le tracé.
 */
export function createRideState({ path, loop = true, startDistanceM = null }) {
  if (!path || path.length < 2) throw new Error('rideState : tracé inexploitable');

  const start = path.startDistance;
  const end = path.endDistance;
  const lapLength = end - start;
  if (!(lapLength > 0)) throw new Error('rideState : tracé de longueur nulle');

  const initial = Number.isFinite(startDistanceM)
    ? Math.min(Math.max(startDistanceM, start), end)
    : start;

  let odometer = 0;
  let routeDistance = initial;
  let laps = 0;
  let speed = 0;
  let finished = false;

  return {
    get path() {
      return path;
    },
    get loop() {
      return loop;
    },
    /** Longueur d'un tour, en mètres. */
    get lapLengthM() {
      return lapLength;
    },
    /** Compteur : tout ce qui a été parcouru depuis le départ. */
    get distanceM() {
      return odometer;
    },
    /** Abscisse courante **sur le tracé**, toujours dans ses bornes. */
    get routeDistanceM() {
      return routeDistance;
    },
    get laps() {
      return laps;
    },
    get speedMs() {
      return speed;
    },
    /** Vrai quand un parcours non bouclé a été terminé. */
    get finished() {
      return finished;
    },

    /** Pente sous le coureur, en tangente (0,08 = 8 %). Positive en montée. */
    get gradeAt() {
      return path.gradeAt(routeDistance);
    },

    /** Position et cap sous le coureur. */
    positionAt() {
      return path.positionAt(routeDistance);
    },

    curvatureAt() {
      return path.curvatureAt(routeDistance);
    },

    /**
     * Fait avancer d'une image.
     *
     * La vitesse est celle que l'appelant vient de calculer. Une vitesse
     * négative est ramenée à zéro : sur un vélo, on n'avance pas à reculons,
     * et un modèle physique qui en produirait une a un bug qu'il ne faut pas
     * traduire en marche arrière à l'écran.
     *
     * @param {number} deltaS secondes écoulées.
     * @param {number} speedMs vitesse au sol, en m/s.
     * @returns {{wrapped: boolean}} `wrapped` quand on vient de repasser la
     *          ligne : la scène doit alors sauter avec le coureur au lieu de
     *          traverser le décor en glissant.
     */
    advance(deltaS, speedMs) {
      speed = Number.isFinite(speedMs) && speedMs > 0 ? speedMs : 0;
      if (!(deltaS > 0) || finished) return { wrapped: false };

      const step = speed * deltaS;
      odometer += step;
      routeDistance += step;

      let wrapped = false;
      while (routeDistance > end) {
        if (!loop) {
          routeDistance = end;
          finished = true;
          break;
        }
        routeDistance -= lapLength;
        laps++;
        wrapped = true;
      }

      return { wrapped };
    },

    /** Remet la séance à zéro, sans changer de parcours. */
    reset() {
      odometer = 0;
      routeDistance = initial;
      laps = 0;
      speed = 0;
      finished = false;
    },
  };
}
