/*
 * peloton — les autres coureurs de la salle, entre deux diffusions.
 * ---------------------------------------------------------------------
 *
 * Ce module tient une carte d'identifiants vers des états, et rend deux
 * lectures très différentes :
 *
 * | | |
 * |---|---|
 * | `participations()` | ce que la scène 3D met sur la route, soixante fois par seconde |
 * | `standings()` | le classement, deux fois par seconde |
 *
 * ## La forme des objets rendus n'est pas la nôtre
 *
 * `participations()` rend des objets à la forme de l'API de Dot Racing —
 * `_id`, `coordinates: {X, Y}`, `current.movementBearing`. C'est laid, et c'est
 * le moindre mal : `riderCrowd.js` est du code **copié** de Dot Racing, dont la
 * divergence se paie à la main dans les deux sens (cf. `CLAUDE.md`). Lui faire
 * parler une forme neuve coûterait une divergence permanente sur un fichier de
 * trois cent soixante-dix lignes et sa batterie de tests ; l'adaptation tient
 * ici en douze lignes, à un seul endroit, et se supprime le jour où les deux
 * jeux se mettent d'accord.
 *
 * ## Les objets sont mutés, jamais reconstruits
 *
 * `riderCrowd` garde la référence qu'on lui a passée au dernier `sync` et la
 * relit à chaque image. Reconstruire les objets à chaque diffusion lui laisserait
 * entre les mains des positions périmées jusqu'au `sync` suivant — un peloton
 * qui avance par à-coups d'un huitième de seconde.
 *
 * ## Un coureur qui se tait n'est pas un coureur arrêté
 *
 * Un onglet fermé, un Wi-Fi qui tombe, un portable qui s'endort : la connexion
 * meurt sans que rien n'annonce le départ. Sans péremption, ces coureurs-là
 * resteraient plantés sur la route pour le reste de la séance. `prune` les
 * retire après quelques secondes de silence — largement plus que l'intervalle
 * de publication, pour qu'un hoquet de réseau ne fasse pas disparaître un
 * voisin qui roule à côté de nous.
 *
 * Module pur : ni réseau, ni Vue, ni horloge. On lui donne le temps qu'il est.
 */

import { colorFor } from './protocol.js';

/** Silence au-delà duquel un coureur est considéré comme parti. */
export const STALE_MS = 6000;

/**
 * @param {Object} options
 * @param {import('../riderScene/routePath.js').RoutePath} options.path Le tracé
 *        de la salle — c'est lui qui transforme une abscisse en position.
 * @param {number} [options.staleMs]
 */
export function createPeloton({ path, staleMs = STALE_MS }) {
  if (!path) throw new Error('peloton : un tracé est nécessaire');

  /** @type {Map<string, Object>} */
  const riders = new Map();

  /** Place un coureur sur le tracé, à son abscisse. */
  function locate(entry) {
    const at = path.positionAt(entry.routeDistanceM);
    if (!at) return;
    entry.participation.coordinates.X = at.lng;
    entry.participation.coordinates.Y = at.lat;
    entry.participation.current.movementBearing = at.bearing;
    entry.participation.lastDistanceItinerary = entry.routeDistanceM;
    entry.participation.current.actualPower = entry.powerW;
    entry.participation.statistics.instantSpeedKmh = entry.speedMs * 3.6;
    // Un coureur à l'arrêt ne doit pas voir sa dernière trajectoire prolongée :
    // l'horloge de lecture s'en sert pour décider si elle continue le mouvement.
    entry.participation.current.state = entry.speedMs > 0.3 ? 'running' : 'idle';
  }

  function create(state) {
    const color = state.color || colorFor(state.id);
    const entry = {
      ...state,
      color,
      seenMs: 0,
      participation: {
        _id: state.id,
        racer: { color, name: state.name },
        coordinates: { X: 0, Y: 0 },
        lastDistanceItinerary: 0,
        current: { state: 'running', movementBearing: 0, actualPower: 0 },
        statistics: { instantSpeedKmh: 0 },
      },
    };
    return entry;
  }

  return {
    get size() {
      return riders.size;
    },

    has(id) {
      return riders.has(id);
    },

    /**
     * Enregistre l'état diffusé par un coureur.
     *
     * @param {Object} state état déjà borné — cf. `sanitizeState`.
     * @param {number} nowMs horloge de l'appelant.
     */
    push(state, nowMs) {
      if (!state?.id) return;
      let entry = riders.get(state.id);
      if (!entry) {
        entry = create(state);
        riders.set(state.id, entry);
      } else {
        entry.name = state.name;
        entry.distanceM = state.distanceM;
        entry.routeDistanceM = state.routeDistanceM;
        entry.powerW = state.powerW;
        entry.speedMs = state.speedMs;
        entry.laps = state.laps;
        entry.participation.racer.name = state.name;
      }
      entry.seenMs = nowMs;
      locate(entry);
    },

    /** Départ annoncé — le seul cas où l'on retire quelqu'un sans attendre. */
    remove(id) {
      riders.delete(id);
    },

    clear() {
      riders.clear();
    },

    /**
     * Retire ceux qui se sont tus.
     * @returns {number} combien sont partis.
     */
    prune(nowMs) {
      let removed = 0;
      for (const [id, entry] of riders) {
        if (nowMs - entry.seenMs <= staleMs) continue;
        riders.delete(id);
        removed++;
      }
      return removed;
    },

    /**
     * Ce que la scène met sur la route. Les objets sont stables d'un appel à
     * l'autre : `riderCrowd` en garde la référence.
     */
    participations() {
      const out = [];
      for (const entry of riders.values()) out.push(entry.participation);
      return out;
    },

    /**
     * Le classement, du premier au dernier.
     *
     * Le compteur classe, pas l'abscisse : sur un parcours qui boucle, celui
     * qui entame son deuxième tour est devant celui qui finit le premier, alors
     * que son abscisse est la plus petite des deux.
     *
     * @param {Object|null} self Notre propre état, pour figurer au classement.
     * @returns {Array<{id:string,name:string,distanceM:number,powerW:number,gapM:number,self:boolean,rank:number}>}
     */
    standings(self = null) {
      const list = [];
      for (const entry of riders.values()) {
        list.push({
          id: entry.id,
          name: entry.name,
          color: entry.color,
          distanceM: entry.distanceM,
          powerW: entry.powerW,
          self: false,
        });
      }
      if (self?.id) {
        list.push({
          id: self.id,
          name: self.name,
          color: self.color ?? colorFor(self.id),
          distanceM: self.distanceM ?? 0,
          powerW: self.powerW ?? 0,
          self: true,
        });
      }

      list.sort((a, b) => b.distanceM - a.distanceM);
      const leader = list.length ? list[0].distanceM : 0;
      return list.map((rider, index) => ({
        ...rider,
        rank: index + 1,
        gapM: leader - rider.distanceM,
      }));
    },
  };
}
