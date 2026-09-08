/*
 * La foule — les autres coureurs dans la bulle du coureur suivi.
 * -------------------------------------------------------------
 * La bulle ne change pas de propriétaire : elle reste centrée sur le coureur
 * suivi, et les autres n'y sont que de passage. C'est ce qui rend la chose
 * traitable — sur une course, les autres sont presque toujours à des dizaines
 * de kilomètres, et il n'y a le plus souvent personne à afficher.
 *
 * Trois règles portent tout ce fichier :
 *
 * 1. **Aucune vraie lumière.** three.js encode le nombre de lumières dans la
 *    clé de programme de chaque matériau : un coureur qui entre dans la bulle
 *    avec ses deux feux recompilerait tous les shaders du décor, terrain et
 *    feuillage compris. Les autres gardent donc le corps de lampe et le halo,
 *    qui sont déjà des faux, et rien d'autre.
 * 2. **Le nombre de coureurs est borné, et l'entrée hystérétique.** Sans écart
 *    entre le seuil d'entrée et celui de sortie, un coureur qui roule à la
 *    frontière apparaîtrait et disparaîtrait plusieurs fois par seconde.
 * 3. **Rien qui dépende de l'ordre d'arrivée.** L'écart latéral d'un coureur se
 *    tire de son identifiant, jamais de son rang : un peloton pose tous ses
 *    coureurs sur les mêmes coordonnées, et ils doivent se ranger côte à côte
 *    au même endroit à chaque fois qu'ils rentrent dans la bulle.
 */

import { RiderModel } from './riderModel.js';
import { createRaceClock } from './raceClock.js';
import { metersBetween } from './routePath.js';
import { createMotionMeter } from './motionMeter.js';
import { leanFor } from './riderPose.js';

/** Distance d'entrée dans la bulle : au-delà, le brouillard les mange. */
export const CROWD_ENTER_M = 900;
/** Distance de sortie. L'écart avec l'entrée est l'hystérésis. */
export const CROWD_LEAVE_M = 1200;
/** Plafond de coureurs affichés — un peloton entier n'est pas une scène.
 *  Ceux hors-champ restent indiqués par un chevron de bord (riderCrowdAvatars.js). */
export const CROWD_MAX = 10;
/** Écart latéral, en mètres : de quoi ne pas s'interpénétrer, sans quitter la chaussée. */
const LATERAL_MIN_M = 0.7;
const LATERAL_MAX_M = 1.6;

/**
 * Écart latéral d'un coureur, tiré de son identifiant.
 *
 * @param {string} id
 * @returns {number} mètres, signés — jamais assez petit pour se confondre avec
 *          le coureur suivi, qui roule à zéro.
 */
export function lateralOffsetFor(id) {
  const key = String(id ?? '');
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const unit = ((hash >>> 0) % 1000) / 999; // 0 → 1
  const magnitude = LATERAL_MIN_M + unit * (LATERAL_MAX_M - LATERAL_MIN_M);
  return (hash & 1) === 0 ? magnitude : -magnitude;
}

/** Un degré de latitude, en mètres — la Terre à l'échelle qui nous occupe. */
const METERS_PER_DEGREE = 111320;

/**
 * Décale un point de `meters` sur sa droite, cap donné.
 *
 * Le décalage se prend en coordonnées et non dans la scène : c'est le sol qui
 * doit être échantillonné au bon endroit, sinon un coureur rangé sur le bas-côté
 * d'une route en dévers flotte ou s'enfonce.
 *
 * @param {number} lng
 * @param {number} lat
 * @param {number} bearingDeg Cap du coureur, 0 = nord.
 * @param {number} meters Signé : positif à droite du cap.
 */
export function offsetRight(lng, lat, bearingDeg, meters) {
  return offsetBy(lng, lat, (Number(bearingDeg) || 0) + 90, meters);
}

/**
 * Décale un point de `meters` **dans la direction d'un cap**.
 *
 * Sert aussi bien à ranger un coureur de front qu'à échantillonner le sol aux
 * quatre coins de l'empreinte du vélo, pour en tirer tangage et dévers
 * (cf. `riderPose.js`).
 *
 * @param {number} lng
 * @param {number} lat
 * @param {number} bearingDeg Cap visé, 0 = nord.
 * @param {number} meters Signé : négatif recule.
 */
export function offsetBy(lng, lat, bearingDeg, meters) {
  const angle = (Number(bearingDeg) || 0) * (Math.PI / 180);
  const north = Math.cos(angle) * meters;
  const east = Math.sin(angle) * meters;
  const cosLat = Math.max(0.01, Math.cos(lat * (Math.PI / 180)));
  return {
    lng: lng + east / (METERS_PER_DEGREE * cosLat),
    lat: lat + north / METERS_PER_DEGREE,
  };
}

/** Coordonnées d'une participation, quel que soit l'endroit où elles sont. */
function coordinatesOf(participation) {
  const c = participation?.coordinates || participation?.racer?.raceState?.coordinates;
  if (!c) return null;
  const lng = Number(c.X);
  const lat = Number(c.Y);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lng, lat };
}

/**
 * Qui mérite d'être dans la scène, et dans quel ordre.
 *
 * Fonction pure : c'est elle qui décide, et elle se teste sans navigateur.
 *
 * @param {Object} options
 * @param {Array} options.participations Toutes les participations de la course.
 * @param {string|null} options.focusId  Le coureur suivi — jamais dans la foule.
 * @param {{lng:number, lat:number}|null} options.focus Position affichée du suivi.
 * @param {Set<string>} [options.present] Ceux qui sont déjà dans la scène.
 * @returns {Array<{id:string, participation:Object, distanceM:number}>} triés du
 *          plus proche au plus lointain, plafonnés.
 */
export function selectCrowd({
  participations,
  focusId,
  focus,
  present = new Set(),
  enterM = CROWD_ENTER_M,
  leaveM = CROWD_LEAVE_M,
  max = CROWD_MAX,
}) {
  if (!Array.isArray(participations) || !focus) return [];

  const candidates = [];
  for (const participation of participations) {
    const id = participation?._id ? String(participation._id) : null;
    if (!id || (focusId && id === String(focusId))) continue;
    const at = coordinatesOf(participation);
    if (!at) continue;

    const distanceM = metersBetween(focus.lng, focus.lat, at.lng, at.lat);
    // Celui qui est déjà là reste jusqu'au seuil de sortie : sans cet écart, un
    // coureur à la frontière clignoterait.
    if (distanceM > (present.has(id) ? leaveM : enterM)) continue;
    candidates.push({ id, participation, distanceM });
  }

  candidates.sort((a, b) => a.distanceM - b.distanceM);
  return candidates.slice(0, max);
}

/**
 * Les autres coureurs, montés et animés dans la scène du coureur suivi.
 *
 * Deux rythmes, comme le reste de la scène : l'appartenance à la bulle se
 * réévalue au rythme du recentrage (`sync`), et le mouvement à chaque image
 * (`advance`). Monter un coureur coûte quelques dizaines de géométries : c'est
 * une entrée dans la bulle, pas une image.
 */
export class RiderCrowd {
  constructor({ THREE, scene, max = CROWD_MAX }) {
    this.THREE = THREE;
    this.scene = scene;
    this.max = max;
    /** @type {Map<string, Object>} un coureur monté, par identifiant. */
    this.riders = new Map();
    this.disposed = false;
  }

  /** Identifiants actuellement montés — l'état que `selectCrowd` doit connaître. */
  get presentIds() {
    return new Set(this.riders.keys());
  }

  /**
   * Fait entrer et sortir les coureurs de la bulle.
   *
   * @param {Array} participations Toutes les participations de la course.
   * @param {{lng:number, lat:number}|null} focus Position affichée du coureur suivi.
   * @param {string|null} focusId
   */
  sync(participations, focus, focusId) {
    if (this.disposed || !focus) return;

    const selected = selectCrowd({
      participations,
      focusId,
      focus,
      present: this.presentIds,
      max: this.max,
    });

    const keep = new Set();
    for (const { id, participation } of selected) {
      keep.add(id);
      const existing = this.riders.get(id);
      if (existing) {
        existing.participation = participation;
        continue;
      }
      this.riders.set(id, this._mount(id, participation));
    }

    for (const [id, entry] of this.riders) {
      if (keep.has(id)) continue;
      entry.model.dispose();
      this.riders.delete(id);
    }
  }

  /**
   * Avance la lecture de chaque coureur et le pose sur le sol.
   *
   * @param {number} delta Secondes écoulées.
   * @param {Object} bubble La bulle de terrain (`world.bubble`).
   * @param {number} roadLift Décollement de la chaussée, comme le coureur suivi.
   * @param {number} nightMix 0 en plein jour, 1 en pleine nuit.
   * @param {Function} bearingToYaw Conversion cap → lacet de la scène.
   * @param {Object} [camera] Caméra de rendu — sert à faire briller plus fort
   *        le clignotant arrière des coureurs lointains, cf. `riderModel.js`
   *        (`setNight`). Sans elle, pas de sur-brillance de loin.
   * @param {number|null} [gameTime] Heure du moteur (`race.lastUpdate`), en
   *        secondes. C'est elle qui date les états reçus : sans elle, l'horloge
   *        leur prête la cadence observée, ce qui suffit mais lisse moins bien.
   */
  advance(delta, { bubble, roadLift = 0, nightMix = 0, bearingToYaw, camera = null, gameTime = null }) {
    if (this.disposed || !bubble) return;

    for (const entry of this.riders.values()) {
      this._pushPosition(entry, gameTime);
      entry.clock.advance(delta);
      const at = entry.clock.positionAt();
      if (!at) {
        entry.ground = null;
        continue;
      }

      // L'écart latéral se prend perpendiculairement au cap : dans un peloton,
      // les coureurs partagent exactement la même position et doivent se ranger
      // de front plutôt que s'interpénétrer.
      const side = offsetRight(at.lng, at.lat, at.bearing, entry.lateral);
      const yaw = bearingToYaw(at.bearing);
      const ground = bubble.toScenePosition(side.lng, side.lat, roadLift);
      // Conservée pour l'appelant : le pin photo au-dessus de la tête n'est
      // pas un objet de la scène (cf. `riderCrowdAvatars.js`), il se projette
      // à partir de cette position, une fois l'image posée.
      entry.ground = ground;

      // La foule n'a pas de tracé — l'API réserve l'itinéraire à son
      // propriétaire —, donc pas de courbure connue d'avance. Sa courbure se
      // déduit du lacet rendu : `κ = ω / v`, au signe près (le lacet croît
      // quand le cap décroît, c'est-à-dire dans les virages à gauche).
      const { speed, turn } = entry.meter.measure(ground.x, ground.z, yaw, delta);
      const curvature = speed > 1 ? -turn / speed : 0;
      const wanted = leanFor(speed, curvature);
      entry.lean += (wanted - entry.lean) * (1 - Math.exp(-delta / 0.35));

      entry.model.setPose(ground, yaw);
      entry.model.advance(delta, {
        speed,
        lean: entry.lean,
        pace: entry.participation?.current?.multipliers?.actualPace,
        power: entry.participation?.current?.actualPower,
      });

      const distanceM = camera
        ? Math.hypot(
            ground.x - camera.position.x,
            ground.y - camera.position.y,
            ground.z - camera.position.z
          )
        : 0;
      entry.model.setNight(nightMix, distanceM);
    }
  }

  /**
   * Les coureurs actuellement montés, avec leur position au sol de la
   * dernière image — pour un appelant qui projette lui-même (le pin photo,
   * en dehors de la scène). `null` tant qu'aucune position n'a encore été
   * reçue.
   * @returns {Array<{id:string, participation:Object, ground:{x:number,y:number,z:number}|null}>}
   */
  entries() {
    const out = [];
    for (const [id, entry] of this.riders) {
      out.push({ id, participation: entry.participation, ground: entry.ground ?? null });
    }
    return out;
  }

  dispose() {
    for (const entry of this.riders.values()) entry.model.dispose();
    this.riders.clear();
    this.disposed = true;
  }

  /** Monte un coureur : silhouette, horloge, mesure du mouvement. */
  _mount(id, participation) {
    const racer = participation?.racer || {};
    const model = new RiderModel({
      THREE: this.THREE,
      scene: this.scene,
      color: racer.color,
      // Ni vraies lumières ni ombre portée : deux coûts qui se paient sur toute
      // la scène, pour un coureur qu'on regarde de loin.
      lights: false,
      castShadow: false,
    });

    const entry = {
      id,
      participation,
      model,
      clock: createRaceClock(),
      meter: createMotionMeter(),
      lateral: lateralOffsetFor(id),
      lean: 0,
      lastLng: null,
      lastLat: null,
      lastDistance: null,
      // Position au sol de la dernière image — cf. `entries()`.
      ground: null,
    };
    return entry;
  }

  /**
   * Met en réserve la position neuve d'un coureur, s'il en est arrivé une.
   *
   * La foule n'a pas de tracé : l'API réserve l'itinéraire à son propriétaire,
   * donc la lecture se fait en droit, d'une position diffusée à la suivante.
   * De loin, la corde coupée dans un virage ne se voit pas. Elle partage en
   * revanche l'horloge du coureur suivi (`raceClock`) : même retard de lecture,
   * même prolongation quand le flux se tarit, donc pas un peloton où l'un
   * s'arrête pendant que l'autre roule.
   */
  _pushPosition(entry, gameTime) {
    const at = coordinatesOf(entry.participation);
    if (!at) return;
    const distance = Number(entry.participation?.lastDistanceItinerary);
    const d = Number.isFinite(distance) ? distance : null;
    if (at.lng === entry.lastLng && at.lat === entry.lastLat && d === entry.lastDistance) return;

    const state = entry.participation?.current?.state;
    const bearing = Number(entry.participation?.current?.movementBearing);
    const stats = entry.participation?.statistics;
    const kmh = Number(stats?.smoothedInstantSpeedKmh ?? stats?.instantSpeedKmh);
    entry.clock.push(
      {
        t: gameTime,
        d,
        lng: at.lng,
        lat: at.lat,
        bearing: Number.isFinite(bearing) ? bearing : null,
        moving: !state || state === 'running',
      },
      // Vitesse annoncée : elle ne sert qu'à l'amorce, pour qu'un coureur qui
      // entre dans la bulle roule tout de suite au lieu de rester planté le
      // temps de la première diffusion.
      Number.isFinite(kmh) && kmh > 0 ? kmh / 3.6 : null
    );
    entry.lastLng = at.lng;
    entry.lastLat = at.lat;
    entry.lastDistance = d;
  }
}
