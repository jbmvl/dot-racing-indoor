/*
 * riderModel — le coureur, au centre de la bulle.
 * ------------------------------------------------
 *
 * **Côté jeu.** Ce module n'appartient pas au générateur de décor : il modèle un
 * coureur de Dot Racing et son vélo — la photo au-dessus de sa tête, elle, est
 * un repère d'interface superposé au rendu, pas un objet de la scène (cf.
 * `composables/map/riderCrowdAvatars.js`) : sa taille ne doit rien à la
 * perspective 3D. Il emprunte au générateur le
 * halo des lampadaires (`createGlowMaterial`) pour que les feux du vélo et
 * l'éclairage public soient faits de la même matière — la dépendance va bien du
 * jeu vers le décor, jamais l'inverse.
 *
 * C'est le seul objet de la scène qu'on regarde en permanence, à quatre mètres,
 * pendant toute une course. Il ne relève donc pas du même arbitrage que le reste
 * du décor : le raisonnement de `furnitureKit` — « à seize mètres, une
 * silhouette suffit » — ne s'applique pas à l'objet qu'on a sous les yeux.
 *
 * ## Pourquoi il n'est pas importé
 *
 * La bonne réponse serait un modèle glTF animé, et elle a été écartée pour trois
 * raisons qui tiennent ensemble :
 *
 * 1. *La licence.* Un cycliste animé réutilisable veut dire un fichier tiers,
 *    donc une licence à vérifier, à porter dans le dépôt et à créditer. Rien
 *    d'insurmontable, mais c'est une décision de projet, pas un détail de rendu.
 * 2. *Le poids.* `GLTFLoader` plus un modèle rigué plus ses animations, c'est le
 *    même ordre de grandeur que three.js lui-même, qu'on prend soin de charger à
 *    la demande.
 * 3. *L'identité.* Le coureur doit porter **sa** couleur et **sa** photo. Un
 *    modèle importé demande de retrouver ses matériaux par nom pour les teinter,
 *    ce qui est exactement le genre de couplage qui casse à la première mise à
 *    jour de l'asset.
 *
 * Ce qui manquait n'était de toute façon pas la finesse du maillage : c'était
 * que **rien ne bougeait**. Un cycliste dont les jambes ne pédalent pas et dont
 * les roues ne tournent pas se lit comme une figurine poussée, quel que soit son
 * nombre de triangles.
 *
 * ## Ce qu'il y a donc à la place
 *
 * Un vélo réellement modelé — cadre en losange, fourche, cintre à cornes,
 * pédalier, roues à rayons — et un coureur **articulé** : cuisse, jambe et pied
 * suivent la manivelle, le buste respire, les épaules roulent. La cadence est
 * déduite de la vitesse réelle (`advance`), donc le pédalage est synchrone du
 * déplacement : c'est ce qui empêche l'effet de patinage.
 *
 * L'ensemble pèse environ 2 900 triangles, soit le prix de vingt lampadaires —
 * pour le seul objet de la scène qu'on regarde en permanence.
 */

import { createGlowGeometry, createGlowMaterial } from 'worldpaint';

/** Développement : mètres parcourus par tour de pédalier, en 50×17 environ. */
const DEVELOPMENT_M = 6.2;
/** Cadence, en tours/minute, au pace 1/10 — la borne basse du pédalage actif. */
const CADENCE_RPM_AT_PACE_1 = 40;
/** Cadence, en tours/minute, au pace 10/10. */
const CADENCE_RPM_AT_PACE_10 = 100;
/** Rayon de roue, en mètres — une 700×25 fait 0,335 m. */
const WHEEL_RADIUS = 0.335;
/** Empattement : distance entre les axes de roue, en mètres. */
const WHEELBASE = 1.02;
/** Longueur de manivelle, en mètres. */
const CRANK_M = 0.1725;
/** Hauteur de l'axe du pédalier au-dessus du sol. */
const BB_HEIGHT = 0.27;
/** Position longitudinale du pédalier (−z est l'avant). */
const BB_Z = 0.09;
/**
 * Hauteur de la hanche, en mètres.
 *
 * Elle n'est pas décorative : avec les longueurs de segment et la position du
 * pédalier, elle fixe l'**extension maximale** de la jambe en bas de course. À
 * 96 % de la longueur jambe tendue, le genou reste toujours un peu fléchi, ce
 * qui est la position réelle et ce qui garde la résolution du genou bien
 * conditionnée. Trop haute, la jambe bute sur son plafond et le genou se fige.
 */
const HIP_Y = 1;
/** Longueurs de segment du coureur, en mètres. */
const THIGH_M = 0.44;
const SHIN_M = 0.46;

// --- Poses d'arrêt (setRestPose) et danseuse (setDance) ---------------------
// 'standing' : hanche recentrée à hauteur réelle, décalée à côté du cadre.
const STAND_HIP_Y = 0.92;
const STAND_OFFSET_X = 0.34;
// 'leaning' (vélo posé, pas de coureur) : inclinaison modeste, pas un vélo tombé.
const LEANING_TILT_RAD = 0.35;
// 'lying' : bascule à 90° autour du point de contact au sol (pivot `lean`).
const LYING_TILT_RAD = Math.PI / 2;
// Danseuse : rock latéral, une fois par tour de manivelle.
const DANCE_ROCK_RAD = 0.16;
const DANCE_HIP_LIFT_M = 0.1;
// Angle de buste assis (cf. _buildBody) — redressé partiellement en danseuse.
const SEATED_TORSO_PITCH_RAD = 1.15;

// --- Éclairage du vélo -------------------------------------------------------
// Intensités en candela : depuis three r155 les lumières ponctuelles sont
// physiques (l'éclairement vaut intensité / distance^decay).
//
// Un phare de vélo, c'est réellement des milliers de candelas — mais la nuit du
// jeu n'est pas noire (`skyModel.lightingFor` garde une ambiance à 0,62 pour que
// le relief reste lisible), donc le faisceau n'a pas à écraser la scène : il
// doit se poser dessus.
const HEADLIGHT_CD = 2000;
// Le feu arrière ne sert pas à éclairer : il pose un liseré rouge sur le dos du
// coureur, qui est précisément ce que la caméra voit. D'où une intensité qui
// paraît minuscule à côté du phare — elle travaille à cinquante centimètres.
const TAILLIGHT_CD = 3;
// Décroissance volontairement plus douce que le carré de la distance. Une lampe
// à 70 cm du sol frappe la route en rasant : le facteur cosinus divise déjà
// l'éclairement par vingt entre trois et quinze mètres. En 1/d² le faisceau
// s'arrêterait à cinq mètres, ce qu'aucun phare ne fait.
const HEADLIGHT_DECAY = 1.35;
// Distance visée par l'axe du faisceau. C'est elle qui dessine le profil du
// halo au sol : le bitume proche se trouve au bord bas du cône (donc adouci par
// la pénombre), le point chaud tombe à cette distance, et au-delà la route
// remonte vers le bord haut et s'éteint progressivement.
const HEADLIGHT_THROW_M = 14;
// Le clignotant arrière n'est plus un éclairage qu'on allume la nuit : c'est un
// feu de sécurité, allumé en permanence, jour compris — c'est lui qui doit
// signaler un coureur dans la foule de loin. Un vrai clignotant flashe court
// puis s'éteint, il ne respire pas : la période et la fraction « allumée »
// dessinent ce flash (0,9 s de cycle, 22 % de flash).
const TAILLIGHT_BLINK_PERIOD_S = 0.9;
const TAILLIGHT_BLINK_ON_S = 0.22;
// Entre deux flashs, le halo reste visible en veilleuse plutôt que de
// disparaître — sans quoi il faudrait le rechercher à chaque coupure.
const TAILLIGHT_BLINK_FLOOR = 0.15;
// En dessous de cette distance, luminosité normale ; au-delà, elle grimpe
// proportionnellement à la distance, plafonnée pour ne pas tout écraser — ce
// que « luminosité » veut dire ici est expliqué sur `createTaillightGlowMaterial`.
const TAILLIGHT_FAR_REF_M = 40;
const TAILLIGHT_FAR_BOOST_MAX = 60;

/**
 * Halo du clignotant arrière — presque le même matériau que
 * `createGlowMaterial` (worldpaint, réutilisé tel quel pour le phare et les
 * lampadaires), à une différence près : ici, `uOpacity` multiplie aussi la
 * **couleur**, pas seulement l'alpha.
 *
 * Le halo est un panneau réel, en mètres, dressé dans l'espace de la vue : en
 * grossir la taille pour le rendre visible de loin lui donnerait l'air d'un
 * ballon flottant au-dessus du coureur — le même problème déjà rencontré avec
 * le pin photo (cf. `riderCrowdAvatars.js`), qui a fait abandonner l'idée. La
 * luminosité était le seul levier qui restait — mais dans le matériau de
 * worldpaint, l'alpha d'un blending additif est une **valeur de mélange**,
 * plafonnée à 1 par le pipeline graphique lui-même : au-delà de
 * `uOpacity = 1`, le pixel du centre du halo (`falloff` proche de 1) est déjà
 * saturé, et rien ne le rend plus lumineux. Faire porter `uOpacity` aussi par
 * la couleur élargit à la place le disque pleinement opaque du dégradé — un
 * halo qui reste minuscule à l'écran garde ainsi un cœur saturé plutôt que de
 * s'effacer dans l'antialiasing, ce qu'une simple hausse d'alpha ne pouvait
 * pas faire.
 */
function createTaillightGlowMaterial(THREE, { color = [1, 0.22, 0.12] } = {}) {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    fog: false,
    uniforms: {
      uColor: { value: new THREE.Vector3(...color) },
      uOpacity: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        // Panneau dressé dans l'espace de la vue : il garde sa taille et sa
        // forme quel que soit l'angle de la caméra — cf. le commentaire du
        // matériau de worldpaint, dont ce shader reprend le principe.
        vec4 centre = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        centre.xy += position.xy;
        gl_Position = projectionMatrix * centre;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float falloff = pow(max(0.0, 1.0 - r), 2.6);
        if (falloff <= 0.001 || uOpacity <= 0.001) discard;
        gl_FragColor = vec4(uColor * falloff * uOpacity, min(1.0, falloff * uOpacity));
      }
    `,
  });
  material.name = 'taillight-glow';
  return material;
}

/** #rrggbb ou rrggbb → entier 0xRRGGBB, avec repli. */
function parseColor(raw, fallback = 0x2b6cb0) {
  if (!raw || typeof raw !== 'string') return fallback;
  const hex = raw.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return fallback;
  return parseInt(hex, 16);
}

export class RiderModel {
  /**
   * @param {Object} options
   * @param {Object} options.THREE
   * @param {Object} options.scene
   * @param {string} [options.color]      Couleur du coureur (hex, avec ou sans #).
   * @param {boolean} [options.lights]    Vraies lumières de vélo. À laisser
   *        **faux** pour tout coureur qui n'est pas celui qu'on suit : le
   *        nombre de lumières fait partie de la clé de programme des matériaux,
   *        donc en ajouter une recompile tous les shaders du décor.
   * @param {boolean} [options.castShadow] Ombre portée dans la carte du soleil.
   */
  constructor({ THREE, scene, color, lights = true, castShadow = true }) {
    this.THREE = THREE;
    this.scene = scene;
    this.disposed = false;
    this._disposables = [];

    // État de l'animation, et les vecteurs de travail qui la servent. Aucune
    // allocation par image : la pose des jambes tourne à soixante hertz.
    this._wheelAngle = 0;
    this._crankAngle = 0;
    this._lean = 0;
    // Pose d'arrêt (cf. setRestPose) — null en course normale.
    this._restMode = null;
    // Balancement en danseuse (cf. setDance), lissé côté appelant.
    this._dance = 0;
    this._up = new THREE.Vector3(0, 1, 0);
    this._foot = new THREE.Vector3();
    this._knee = new THREE.Vector3();
    this._axis = new THREE.Vector3();
    this._perp = new THREE.Vector3();
    this._dir = new THREE.Vector3();

    const tint = parseColor(color);

    this.group = new THREE.Group();
    this.group.name = 'rider';
    scene.add(this.group);

    const track = (resource) => {
      this._disposables.push(resource);
      return resource;
    };

    const materials = {
      jersey: track(new THREE.MeshLambertMaterial({ color: tint })),
      dark: track(new THREE.MeshLambertMaterial({ color: 0x1c1f26 })),
      skin: track(new THREE.MeshLambertMaterial({ color: 0xc79b7c })),
      frame: track(new THREE.MeshLambertMaterial({ color: tint })),
      metal: track(new THREE.MeshLambertMaterial({ color: 0x9aa0a6 })),
      rubber: track(new THREE.MeshLambertMaterial({ color: 0x25282d })),
    };
    this.materials = materials;

    // Le vélo et le coureur sont dans un pivot commun qui s'incline dans les
    // virages : un cycliste qui tourne sans se pencher est la seule chose qu'on
    // remarque avant même les jambes qui ne pédalent pas.
    this.lean = new THREE.Group();
    this.lean.name = 'rider-lean';
    this.group.add(this.lean);

    this._buildBike(track, materials);
    this._buildBody(track, materials);

    // Ombre portée réelle. Le disque sombre qui tenait lieu d'ombre avant la
    // carte d'ombres a été retiré : il se superposerait à la vraie, et se
    // trahissait de toute façon en restant rond quelle que soit la hauteur du
    // soleil. Sous l'horizon il n'y a plus d'ombre du tout — c'est correct.
    if (castShadow) {
      this.lean.traverse((child) => {
        if (child.isMesh) child.castShadow = true;
      });
    }

    // Éclairage du vélo. Un cycliste qui roule de nuit sans feux serait le seul
    // objet de la scène à ne pas suivre l'heure — et c'est celui qu'on regarde.
    //
    // Chaque feu est fait de trois pièces, qui ne font pas le même travail :
    //   1. une **vraie** lumière, qui éclaire le décor — la route devant, le dos
    //      du coureur derrière ;
    //   2. le corps de la lampe, non éclairé, qui donne le point vif ;
    //   3. un halo face caméra, qui donne la diffusion dans l'air.
    // La version précédente n'avait que le halo, et sous forme de `Sprite` sans
    // `map` : un `SpriteMaterial` sans texture est un carré plein, d'où les deux
    // carrés blanc et rouge. Le halo réutilise donc le matériau des lampadaires
    // (`furnitureKit`), dont le dégradé radial est calculé dans le shader.
    this._buildLamps(track, lights);
  }

  /**
   * Le vélo : cadre en losange, fourche, cintre, pédalier, deux roues.
   *
   * Tout est en tubes — des cylindres tendus entre deux points (`_tube`) —, ce
   * qui rend le cadre lisible sans le décrire sommet par sommet. Les roues sont
   * dans leur propre pivot pour pouvoir tourner, et les manivelles dans un
   * autre, parce que ce sont elles qui commandent les jambes.
   */
  _buildBike(track, materials) {
    const THREE = this.THREE;
    const bike = new THREE.Group();
    bike.name = 'bike';
    this.lean.add(bike);

    // Points caractéristiques du cadre, en mètres. Origine au sol, -z devant.
    const bb = [0, BB_HEIGHT, BB_Z]; // boîtier de pédalier
    const rearAxle = [0, WHEEL_RADIUS, BB_Z + 0.41];
    const frontAxle = [0, WHEEL_RADIUS, BB_Z + 0.41 - WHEELBASE];
    const seatTop = [0, 0.88, BB_Z + 0.17];
    const headTop = [0, 0.86, BB_Z - 0.53];
    const headBottom = [0, 0.66, BB_Z - 0.58];

    const tube = (a, b, radius, material) => bike.add(this._tube(track, a, b, radius, material));

    tube(bb, seatTop, 0.017, materials.frame); // tube de selle
    tube(bb, headBottom, 0.021, materials.frame); // tube diagonal
    tube(seatTop, headTop, 0.018, materials.frame); // tube supérieur
    tube(headBottom, headTop, 0.019, materials.frame); // tube de direction
    tube(headBottom, frontAxle, 0.014, materials.metal); // fourche
    for (const side of [-0.055, 0.055]) {
      tube([side, bb[1], bb[2]], [side, rearAxle[1], rearAxle[2]], 0.011, materials.frame); // bases
      tube([side, seatTop[1] - 0.06, seatTop[2]], [side, rearAxle[1], rearAxle[2]], 0.009, materials.frame); // haubans
    }

    // Selle et tige.
    tube(seatTop, [0, seatTop[1] + 0.14, seatTop[2] + 0.02], 0.014, materials.metal);
    const saddle = new THREE.Mesh(track(new THREE.BoxGeometry(0.075, 0.035, 0.27)), materials.dark);
    saddle.position.set(0, seatTop[1] + 0.16, seatTop[2] + 0.04);
    saddle.rotation.x = -0.1;
    bike.add(saddle);

    // Cintre de route : potence, corps, et les deux cornes qui plongent. Ce sont
    // elles qui font reconnaître un vélo de course plutôt qu'un VTT.
    const barY = headTop[1] + 0.03;
    const barZ = headTop[2] - 0.06;
    tube(headTop, [0, barY, barZ], 0.014, materials.metal);
    tube([-0.2, barY, barZ], [0.2, barY, barZ], 0.013, materials.dark);
    for (const side of [-0.2, 0.2]) {
      tube([side, barY, barZ], [side, barY - 0.02, barZ - 0.1], 0.012, materials.dark);
      tube([side, barY - 0.02, barZ - 0.1], [side, barY - 0.13, barZ - 0.06], 0.012, materials.dark);
    }

    // Roues : jante, pneu, moyeu et rayons, dans un pivot qui tourne.
    this.wheels = [];
    for (const axle of [rearAxle, frontAxle]) {
      const pivot = new THREE.Group();
      pivot.position.set(axle[0], axle[1], axle[2]);
      // La roue est dans le plan (y, z) : son axe est X.
      pivot.rotation.y = Math.PI / 2;
      bike.add(pivot);

      const tyre = new THREE.Mesh(track(new THREE.TorusGeometry(WHEEL_RADIUS, 0.014, 5, 22)), materials.rubber);
      pivot.add(tyre);
      const rim = new THREE.Mesh(track(new THREE.TorusGeometry(WHEEL_RADIUS - 0.022, 0.011, 4, 22)), materials.metal);
      pivot.add(rim);
      const hub = new THREE.Mesh(track(new THREE.CylinderGeometry(0.022, 0.022, 0.09, 6)), materials.metal);
      hub.rotation.x = Math.PI / 2;
      pivot.add(hub);

      // Six rayons : à cette distance, davantage se referme en un disque gris.
      // Six suffisent à ce que la rotation se **voie**, ce qui est tout ce qu'on
      // leur demande.
      const spokeGeometry = track(new THREE.CylinderGeometry(0.0035, 0.0035, WHEEL_RADIUS * 2 - 0.05, 3));
      for (let i = 0; i < 3; i++) {
        const spoke = new THREE.Mesh(spokeGeometry, materials.metal);
        spoke.rotation.z = (i / 3) * Math.PI;
        pivot.add(spoke);
      }
      this.wheels.push(pivot);
    }

    // Pédalier : plateau, et deux manivelles opposées portant leur pédale.
    this.cranks = new THREE.Group();
    this.cranks.position.set(0, bb[1], bb[2]);
    this.cranks.rotation.y = Math.PI / 2;
    bike.add(this.cranks);

    const chainring = new THREE.Mesh(track(new THREE.CylinderGeometry(0.095, 0.095, 0.006, 12)), materials.metal);
    chainring.rotation.x = Math.PI / 2;
    chainring.position.set(0, 0, 0.04);
    this.cranks.add(chainring);

    this.pedals = [];
    const crankGeometry = track(new THREE.BoxGeometry(0.022, CRANK_M, 0.016));
    const pedalGeometry = track(new THREE.BoxGeometry(0.05, 0.012, 0.075));
    for (const side of [1, -1]) {
      const arm = new THREE.Group();
      arm.rotation.z = side > 0 ? 0 : Math.PI;
      this.cranks.add(arm);

      const crank = new THREE.Mesh(crankGeometry, materials.metal);
      crank.position.set(0, CRANK_M / 2, side * 0.07);
      arm.add(crank);

      const pedal = new THREE.Group();
      pedal.position.set(0, CRANK_M, side * 0.075);
      arm.add(pedal);
      const plate = new THREE.Mesh(pedalGeometry, materials.dark);
      // Le pédalier est monté tourné d'un quart de tour (son axe est X) : la
      // plaque doit revenir dans le plan de marche.
      plate.rotation.y = -Math.PI / 2;
      pedal.add(plate);
      this.pedals.push({ pedal, plate, side });
    }
  }

  /**
   * Le coureur : buste penché, bras tendus au cintre, jambes articulées.
   *
   * Les jambes sont le seul endroit où il y a un vrai calcul. Le pied est
   * accroché à la pédale, donc sa position est **imposée** par l'angle de
   * manivelle ; la hanche est fixe. Restent la cuisse et la jambe, dont les
   * longueurs sont connues : c'est un problème à deux segments, et il se résout
   * exactement (`_solveLeg`). C'est ce qui donne un genou qui monte et descend
   * comme il faut, au lieu d'une jambe qui coulisse.
   */
  _buildBody(track, materials) {
    const THREE = this.THREE;
    const body = new THREE.Group();
    body.name = 'rider-body';
    this.lean.add(body);
    // Gardé à part : caché tel quel en pose 'leaning' (vélo seul, sans coureur).
    this.body = body;

    // Hanche : sur la selle, un peu en avant. C'est le pivot de tout le buste.
    this.hip = new THREE.Group();
    this.hip.position.set(0, HIP_Y, BB_Z + 0.14);
    body.add(this.hip);
    // Position assise d'origine — sert à restaurer la hanche en sortant d'une
    // pose d'arrêt ('standing' la déplace ailleurs).
    this._seatedHipPos = this.hip.position.clone();

    // Buste : penché sur le cintre. Il est dans le pivot de hanche pour que la
    // respiration et le balancement se propagent aux épaules et à la tête.
    const torso = new THREE.Mesh(track(new THREE.CapsuleGeometry(0.155, 0.44, 5, 10)), materials.jersey);
    torso.position.set(0, 0.14, -0.2);
    torso.rotation.x = -SEATED_TORSO_PITCH_RAD;
    this.hip.add(torso);
    // Redressé en danseuse (cf. advance/setDance).
    this._torso = torso;

    const shoulders = new THREE.Mesh(track(new THREE.CapsuleGeometry(0.085, 0.26, 4, 8)), materials.jersey);
    shoulders.position.set(0, 0.27, -0.42);
    shoulders.rotation.z = Math.PI / 2;
    this.hip.add(shoulders);

    // Casque : une calotte, pas une sphère. Un casque de route est allongé et
    // se prolonge sur la nuque, et c'est cette silhouette qu'on reconnaît de dos.
    const helmet = new THREE.Mesh(track(new THREE.SphereGeometry(0.115, 10, 8)), materials.dark);
    helmet.scale.set(1, 0.82, 1.35);
    helmet.position.set(0, 0.34, -0.56);
    this.hip.add(helmet);
    const nape = new THREE.Mesh(track(new THREE.SphereGeometry(0.085, 8, 6)), materials.skin);
    nape.position.set(0, 0.28, -0.48);
    this.hip.add(nape);

    // Bras : de l'épaule aux cornes du cintre. Ils ne bougent pas — un coureur
    // assis a les bras figés, c'est le bassin qui travaille.
    const armGeometry = track(new THREE.CapsuleGeometry(0.042, 0.4, 3, 6));
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(armGeometry, materials.jersey);
      arm.position.set(side * 0.185, 0.12, -0.62);
      arm.rotation.x = -1.28;
      this.hip.add(arm);
    }

    // Jambes : deux segments par jambe, réorientés à chaque image.
    this.legs = [];
    const thighGeometry = track(new THREE.CapsuleGeometry(0.075, THIGH_M - 0.11, 4, 8));
    const shinGeometry = track(new THREE.CapsuleGeometry(0.052, SHIN_M - 0.09, 4, 8));
    const shoeGeometry = track(new THREE.BoxGeometry(0.075, 0.045, 0.19));

    for (const side of [1, -1]) {
      const hip = new THREE.Vector3(side * 0.085, HIP_Y, BB_Z + 0.14);

      const thigh = new THREE.Mesh(thighGeometry, materials.skin);
      const shin = new THREE.Mesh(shinGeometry, materials.skin);
      const shoe = new THREE.Mesh(shoeGeometry, materials.dark);
      body.add(thigh, shin, shoe);
      this.legs.push({ side, hip, thigh, shin, shoe });
    }
  }

  /**
   * Cylindre tendu entre deux points. C'est ce qui permet de décrire un cadre
   * par ses **nœuds** plutôt que par des positions et des angles calculés à la
   * main, lesquels sont impossibles à relire et faux dès qu'on déplace un point.
   */
  _tube(track, a, b, radius, material) {
    const THREE = this.THREE;
    const start = new THREE.Vector3(...a);
    const end = new THREE.Vector3(...b);
    const direction = new THREE.Vector3().subVectors(end, start);
    const length = direction.length() || 1e-4;

    const mesh = new THREE.Mesh(track(new THREE.CylinderGeometry(radius, radius, length, 6)), material);
    mesh.position.copy(start).addScaledVector(direction, 0.5);
    // Le cylindre de three est d'axe Y : on l'amène sur la direction voulue.
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    return mesh;
  }

  /**
   * Monte les deux feux : lumières réelles, corps de lampe, halos.
   * -z est l'avant du coureur — le phare y va, la loupiote rouge derrière.
   * @param {(resource:Object) => Object} track Enregistre une ressource à libérer.
   */
  _buildLamps(track, lights = true) {
    const THREE = this.THREE;

    // Phare avant : un projecteur, pas une lumière ponctuelle. C'est l'angle du
    // cône qui fait qu'on reconnaît un phare de vélo plutôt qu'une ampoule
    // accrochée au guidon. Il ne projette pas d'ombre : la scène n'a qu'une
    // carte d'ombres, celle du soleil, et une seconde doublerait le coût du
    // rendu pour des ombres qu'on ne verrait que de nuit.
    if (lights) {
      this.headlight = track(
        new THREE.SpotLight(0xfff0cf, 0, 90, 0.32, 0.75, HEADLIGHT_DECAY)
      );
      this.headlight.name = 'rider-headlight';
      this.headlight.position.set(0, 0.78, -0.56);
      this.headlightTarget = new THREE.Object3D();
      this.headlightTarget.position.set(0, -0.12, -HEADLIGHT_THROW_M);
      this.lean.add(this.headlightTarget);
      this.headlight.target = this.headlightTarget;
      this.lean.add(this.headlight);
    }

    // Feu arrière : ponctuel et de courte portée, il ne doit teinter que le dos
    // du coureur et le bitume immédiat.
    if (lights) {
      this.taillight = track(new THREE.PointLight(0xff2d18, 0, 6, 1.5));
      this.taillight.name = 'rider-taillight';
      this.taillight.position.set(0, 0.86, 0.32);
      this.lean.add(this.taillight);
    }

    // Les deux vraies lumières restent **toujours** dans le graphe, même en
    // plein jour, avec une intensité nulle : rendre une lumière invisible
    // change le nombre de lumières de la scène, donc la clé de programme de
    // tous les matériaux — le crépuscule provoquerait une recompilation
    // complète des shaders.
    //
    // Les corps et halos, eux, n'ont pas cette contrainte (ce sont de simples
    // meshes) : ils sont donc dans deux groupes séparés, parce que leur
    // visibilité ne suit plus la même règle. Le phare reste de nuit
    // uniquement (`headLamp`, piloté par `setNight`) ; le clignotant arrière
    // est un feu de sécurité, allumé en permanence (`tailLamp`) — c'est lui
    // qui doit signaler un coureur dans la foule, de jour comme de nuit.
    this.headLamp = new THREE.Group();
    this.headLamp.name = 'rider-headlamp';
    this.headLamp.visible = false;
    this.lean.add(this.headLamp);

    this.tailLamp = new THREE.Group();
    this.tailLamp.name = 'rider-taillamp';
    this.lean.add(this.tailLamp);

    this.glows = [];
    for (const lamp of [
      { group: this.headLamp, tint: 0xfff3da, glow: [1, 0.93, 0.74], y: 0.78, z: -0.6, body: 0.05, halo: 0.6, peak: 0.9 },
      // Halo bien plus large que le phare et poussé au maximum : c'est le
      // repère qu'on doit reconnaître de loin dans la foule, le phare n'a lui
      // qu'à se voir de près.
      { group: this.tailLamp, tint: 0xff4a2a, glow: [1, 0.22, 0.12], y: 0.86, z: 0.34, body: 0.05, halo: 0.95, peak: 1, boostable: true },
    ]) {
      // Corps de lampe : `MeshBasicMaterial`, donc insensible à l'éclairage —
      // une lampe allumée émet sa lumière, elle n'en reçoit pas.
      const body = new THREE.Mesh(
        track(new THREE.SphereGeometry(lamp.body, 8, 6)),
        track(new THREE.MeshBasicMaterial({ color: lamp.tint, fog: false }))
      );
      body.position.set(0, lamp.y, lamp.z);
      lamp.group.add(body);

      // Halo. La géométrie est mise à l'échelle une fois pour toutes : le shader
      // dresse le panneau dans l'espace de la vue à partir de `position.xy`, et
      // ignore donc l'échelle de l'objet hors instanciation.
      const geometry = track(createGlowGeometry(THREE));
      geometry.scale(lamp.halo, lamp.halo, 1);
      // Le clignotant arrière a son propre matériau : lui seul doit pouvoir
      // dépasser une opacité de 1 sans être plafonné — cf.
      // `createTaillightGlowMaterial`.
      const material = track(
        lamp.boostable
          ? createTaillightGlowMaterial(THREE, { color: lamp.glow })
          : createGlowMaterial(THREE, { color: lamp.glow })
      );
      const glow = new THREE.Mesh(geometry, material);
      glow.position.set(0, lamp.y, lamp.z);
      glow.renderOrder = 8;
      glow.frustumCulled = false;
      lamp.group.add(glow);
      this.glows.push({ material, peak: lamp.peak });
    }
  }

  /**
   * Allume le phare de nuit, et fait flasher le clignotant arrière — celui-ci
   * en permanence, jour compris. Appelée à chaque image.
   * @param {number} mix 0 en plein jour, 1 en pleine nuit.
   * @param {number} [distanceM] Distance caméra → coureur, en mètres. Au-delà
   *        de `TAILLIGHT_FAR_REF_M`, le clignotant brille plus fort — voir le
   *        commentaire sur les constantes `TAILLIGHT_FAR_*`.
   */
  setNight(mix, distanceM = 0) {
    const value = Math.min(1, Math.max(0, Number(mix) || 0));

    // Un coureur de la foule n'a pas de vraie lumière — cf. `_buildLamps`.
    if (this.headlight) this.headlight.intensity = HEADLIGHT_CD * value;

    this.headLamp.visible = value > 0.02;
    if (this.headLamp.visible) {
      // Le halo enfle un peu à mesure que la nuit tombe : c'est ce que fait
      // l'œil, pas la lampe, mais c'est ainsi qu'on le perçoit.
      const swell = 0.45 + value * 0.55;
      this.glows[0].material.uniforms.uOpacity.value = this.glows[0].peak * swell;
    }

    // Flash bref suivi d'un creux — pas une respiration : un clignotant réel
    // s'éteint entre deux flashs, il ne s'assombrit pas progressivement.
    const t = (performance.now() / 1000) % TAILLIGHT_BLINK_PERIOD_S;
    const flash = t < TAILLIGHT_BLINK_ON_S ? Math.sin((t / TAILLIGHT_BLINK_ON_S) * Math.PI) : 0;
    const strobe = TAILLIGHT_BLINK_FLOOR + (1 - TAILLIGHT_BLINK_FLOOR) * flash;

    const d = Number(distanceM);
    const farBoost = d > TAILLIGHT_FAR_REF_M
      ? Math.min(TAILLIGHT_FAR_BOOST_MAX, d / TAILLIGHT_FAR_REF_M)
      : 1;

    if (this.taillight) this.taillight.intensity = TAILLIGHT_CD * strobe * farBoost;
    this.glows[1].material.uniforms.uOpacity.value = this.glows[1].peak * strobe * farBoost;
  }

  /**
   * Place et oriente le coureur.
   *
   * L'ordre d'Euler est `YXZ` — lacet, puis tangage, puis roulis — c'est-à-dire
   * l'ordre naturel d'un véhicule : le cap tourne dans le monde, l'assiette se
   * prend dans le repère du vélo. Avec l'ordre par défaut (`XYZ`), un vélo
   * cabré et orienté au sud-est se serait mis de travers.
   *
   * Le tangage et le dévers vont sur le pivot extérieur (c'est le sol qui les
   * impose), l'inclinaison de virage sur le pivot intérieur `lean` (c'est le
   * coureur qui la choisit) : elles se composent alors sans se contredire.
   *
   * @param {{x:number,y:number,z:number}} position Repère local, y = sol.
   * @param {number} yaw   Rotation autour de Y, en radians — la tangente de la
   *        trajectoire, jamais un cap moyen : un vélo qui n'est pas orienté
   *        selon son déplacement glisse visiblement sous la route.
   * @param {number} [pitch] Tangage, en radians. Positif en montée.
   * @param {number} [roll]  Dévers, en radians. Positif = couché vers la droite,
   *        même convention que `lean` — cf. `riderPose.js`.
   */
  setPose(position, yaw, pitch = 0, roll = 0) {
    this.group.position.set(position.x, position.y, position.z);
    this.group.rotation.order = 'YXZ';
    this.group.rotation.set(pitch, yaw, -roll);
  }

  /**
   * Fait tourner les roues, pédaler les jambes et pencher le vélo.
   *
   * ## La cadence vient de la puissance et du pace, pas de la vitesse
   *
   * 0 W est la roue libre du moteur — le coureur descend sans pédaler, quelle
   * que soit sa vitesse — et les jambes s'arrêtent net, peu importe le pace
   * affiché. Dès qu'il y a de la puissance, la cadence suit le pace (1 à 10)
   * linéairement, de 40 tours/minute à 1/10 jusqu'à 100 à 10/10 : un coureur
   * qui subit un coup de mou en pente garde ses jambes lentes, peu importe
   * l'allure réelle au sol. Tant que ni la puissance ni le pace ne sont connus
   * (course pas encore chargée), la vitesse sert de repli pour ne pas figer le
   * coureur.
   *
   * Les roues, elles, tournent à la vitesse réelle : c'est le même sol qui défile.
   *
   * @param {number} delta Secondes écoulées.
   * @param {Object} [motion]
   * @param {number} [motion.speed] Vitesse au sol, en m/s.
   * @param {number} [motion.lean]  Inclinaison en virage, en radians, **déjà
   *        filtrée** — positive vers la droite. Elle se calcule sur la courbure
   *        du tracé (cf. `riderPose.js`), donc en avance sur le virage ; le
   *        modèle ne fait que l'appliquer.
   * @param {number} [motion.pace]  Pace moteur, 1 à 10.
   * @param {number} [motion.power] Puissance moteur, en W — 0 ou moins = roue libre.
   */
  advance(delta, { speed = 0, lean = 0, pace, power } = {}) {
    if (this.disposed || !Number.isFinite(delta) || delta <= 0) return;
    // Pose d'arrêt : figée par `_applyRestPose`, rien à animer à chaque image
    // (roues et pédalier restent sur leur dernier angle).
    if (this._restMode) return;
    const v = Math.max(0, Number(speed) || 0);

    // Roues : la circonférence développée est la distance parcourue. `-z` est
    // l'avant, et le pivot de roue tourne autour de son axe local Z.
    this._wheelAngle = (this._wheelAngle + (v * delta) / WHEEL_RADIUS) % (Math.PI * 2);
    for (const wheel of this.wheels) wheel.rotation.z = -this._wheelAngle;

    // Pédalier.
    const p = Number(pace);
    const w = Number(power);
    let cadence; // tours par seconde
    if (Number.isFinite(w) && w <= 0) {
      cadence = 0; // roue libre : puissance nulle, jambes arrêtées net
    } else if (Number.isFinite(p) && p > 0) {
      const clamped = Math.max(1, Math.min(10, p));
      const rpm = CADENCE_RPM_AT_PACE_1 + ((clamped - 1) / 9) * (CADENCE_RPM_AT_PACE_10 - CADENCE_RPM_AT_PACE_1);
      cadence = rpm / 60;
    } else if (Number.isFinite(p)) {
      cadence = 0; // pace connu à 0, puissance inconnue : traité comme roue libre
    } else {
      cadence = v > 0.4 ? v / DEVELOPMENT_M : 0; // ni pace ni puissance connus
    }
    this._crankAngle = (this._crankAngle + cadence * Math.PI * 2 * delta) % (Math.PI * 2);
    if (this.cranks) this.cranks.rotation.z = -this._crankAngle;

    this._poseLegs();

    // Balancement du buste, synchrone du pédalage : deux battements par tour de
    // manivelle, parce qu'il y a deux jambes. C'est un mouvement de deux
    // centimètres, et son absence est ce qui donne l'air d'une figurine.
    if (this.hip) {
      const effort = Math.min(1, v / 11);
      this.hip.rotation.z = Math.sin(this._crankAngle * 2) * 0.035 * effort;
      this.hip.position.y = HIP_Y + Math.sin(this._crankAngle * 2 + 0.6) * 0.012 * effort + DANCE_HIP_LIFT_M * this._dance;
    }
    // Danseuse : buste redressé à mesure que `_dance` monte (cf. setDance).
    if (this._torso) this._torso.rotation.x = -SEATED_TORSO_PITCH_RAD + 0.55 * this._dance;

    // Inclinaison en virage. Le calcul et le filtrage sont chez l'appelant :
    // eux seuls connaissent la courbure du tracé, et c'est elle — pas le lacet
    // déjà rendu — qui dit vers où et quand se pencher.
    //
    // `-x` est la gauche du coureur, donc une rotation positive autour de `z`
    // couche le haut du corps à gauche : pencher à droite s'écrit bien `-lean`.
    // En danseuse, le vélo bascule d'un côté sur l'autre, une fois par tour de
    // manivelle — s'ajoute à l'inclinaison de virage plutôt que la remplacer.
    this._lean = Number(lean) || 0;
    if (this.lean) {
      const rock = this._dance > 0.001 ? Math.sin(this._crankAngle) * DANCE_ROCK_RAD * this._dance : 0;
      this.lean.rotation.z = -this._lean + rock;
    }
  }

  /**
   * Danseuse — amplitude 0..1, lissée par l'appelant (cf. useRiderScene) sur
   * une accélération : redresse le buste et fait rocker vélo+coureur au
   * rythme du pédalier. N'a aucun effet en pose d'arrêt (`_restMode`).
   */
  setDance(amount) {
    this._dance = Math.min(1, Math.max(0, Number(amount) || 0));
  }

  /**
   * Pose d'arrêt : 'standing' (debout à côté du vélo), 'leaning' (vélo seul
   * posé), 'lying' (allongé), ou `null` pour le pédalage normal. Figée une
   * fois au changement — `advance()` n'anime plus rien tant qu'active.
   */
  setRestPose(mode) {
    const next = mode === 'standing' || mode === 'leaning' || mode === 'lying' ? mode : null;
    if (this._restMode === next) return;
    this._restMode = next;
    this._applyRestPose();
  }

  _applyRestPose() {
    const mode = this._restMode;
    if (this.body) this.body.visible = mode !== 'leaning';
    if (this.lean) this.lean.rotation.z = mode === 'lying' ? LYING_TILT_RAD : mode === 'leaning' ? -LEANING_TILT_RAD : 0;
    if (this._torso) this._torso.rotation.x = -SEATED_TORSO_PITCH_RAD;
    this._dance = 0;

    if (mode === 'standing' || mode === 'lying') {
      // Jambes tendues, debout à côté du cadre — pose statique, pas d'IK de
      // pédalage. 'lying' réutilise la même géométrie : c'est la bascule à
      // 90° de `this.lean` (ci-dessus) qui la couche au sol.
      this.hip.position.set(STAND_OFFSET_X, STAND_HIP_Y, BB_Z + 0.14);
      this.hip.rotation.set(SEATED_TORSO_PITCH_RAD, 0, 0); // annule le buste penché du torse (même axe, cf. advance)
      const V = this.THREE.Vector3;
      for (const leg of this.legs) {
        const x = STAND_OFFSET_X + leg.side * 0.09;
        const hip = new V(x, STAND_HIP_Y, BB_Z + 0.14);
        const knee = new V(x, STAND_HIP_Y * 0.52, BB_Z + 0.16);
        const foot = new V(x, 0.02, BB_Z + 0.18);
        this._stretch(leg.thigh, hip, knee);
        this._stretch(leg.shin, knee, foot);
        leg.shoe.position.set(foot.x, foot.y - 0.02, foot.z);
        leg.shoe.rotation.set(0, 0, 0);
      }
    } else if (!mode) {
      // Retour au pédalage : restaure la hanche assise, `_poseLegs()` reprend
      // la main sur les jambes dès la prochaine image.
      this.hip.position.copy(this._seatedHipPos);
      this.hip.rotation.set(0, 0, 0);
    }
    // 'leaning' : le corps est caché (ci-dessus), les jambes n'ont pas besoin
    // d'être reposées.
  }

  /**
   * Oriente cuisse, jambe et pied de chaque jambe sur sa pédale.
   *
   * La hanche est fixe, le pied est sur la pédale : il ne reste qu'à placer le
   * genou. Deux segments de longueurs connues dont on impose les deux
   * extrémités, c'est l'intersection de deux cercles — une seule racine à
   * choisir, celle qui met le genou **devant**, parce qu'un genou qui plie à
   * l'envers est la première chose qu'on voit.
   */
  _poseLegs() {
    if (!this.legs || !this.pedals) return;

    for (let i = 0; i < this.legs.length; i++) {
      const leg = this.legs[i];
      const pedal = this.pedals[i];
      if (!pedal) continue;

      // Position du pied, calculée et non lue dans le graphe : `getWorldPosition`
      // rendrait la matrice de l'image **précédente**, puisque three ne les met à
      // jour qu'au moment du rendu. Le décalage d'une image ne se voit pas sur un
      // objet lointain ; sur un pied accroché à une pédale, si.
      // Les deux manivelles sont opposées : le signe du côté suffit à les
      // déphaser d'un demi-tour, sans recalculer un angle.
      const s = leg.side;
      const foot = this._foot.set(
        s * 0.075,
        BB_HEIGHT + s * Math.cos(this._crankAngle) * CRANK_M + 0.045,
        BB_Z - s * Math.sin(this._crankAngle) * CRANK_M
      );

      const knee = this._solveLeg(leg.hip, foot, THIGH_M, SHIN_M);
      this._stretch(leg.thigh, leg.hip, knee);
      this._stretch(leg.shin, knee, foot);

      // Chaussure : au pied, à peu près à plat, légèrement pointe en bas.
      leg.shoe.position.set(foot.x, foot.y - 0.035, foot.z);
      leg.shoe.rotation.set(0.12, 0, 0);

      // La pédale reste horizontale : le pivot annule la rotation du pédalier.
      pedal.pedal.rotation.z = this._crankAngle;
    }
  }

  /**
   * Place le genou : intersection des deux sphères de rayon `thigh` autour de la
   * hanche et `shin` autour du pied, résolue dans le plan sagittal. Le genou est
   * poussé **vers l'avant** (−z), ce qui est le seul sens dans lequel il plie.
   */
  _solveLeg(hip, foot, thigh, shin) {
    const axis = this._axis.subVectors(foot, hip);
    // Hanche et pédale ne peuvent pas être plus éloignées que la jambe tendue :
    // sans ce plafond, la racine carrée passe dans les négatifs et le genou part
    // à l'infini le temps d'une image.
    const span = Math.min(Math.max(1e-4, axis.length()), thigh + shin - 1e-3);
    axis.normalize();

    const along = (span * span + thigh * thigh - shin * shin) / (2 * span);
    const offset = Math.sqrt(Math.max(0, thigh * thigh - along * along));

    // Perpendiculaire à l'axe, dans le plan sagittal, orientée vers l'avant.
    const perp = this._perp.set(0, axis.z, -axis.y);
    if (perp.lengthSq() < 1e-8) perp.set(0, 0, -1);
    perp.normalize();
    if (perp.z > 0) perp.negate();

    return this._knee.copy(hip).addScaledVector(axis, along).addScaledVector(perp, offset);
  }

  /** Tend un membre capsulaire entre deux points : position et orientation. */
  _stretch(mesh, from, to) {
    const direction = this._dir.subVectors(to, from);
    if (direction.lengthSq() < 1e-8) return;
    mesh.position.copy(from).addScaledVector(direction, 0.5);
    mesh.quaternion.setFromUnitVectors(this._up, direction.normalize());
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.group);
    for (const resource of this._disposables) resource.dispose?.();
    this._disposables.length = 0;
  }
}
