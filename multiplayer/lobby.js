/*
 * lobby — le salon : quelles salles sont ouvertes, et sur quel parcours.
 * ---------------------------------------------------------------------
 *
 * ## Pourquoi il existe
 *
 * Une salle est l'empreinte géométrique d'un tracé (cf. `protocol.js`) : deux
 * personnes qui ont le même GPX s'y retrouvent sans s'être rien dit. Élégant,
 * et muet — tant qu'on n'a pas le fichier de l'autre, on ne peut ni savoir
 * qu'il roule, ni le rejoindre. Le salon est ce qui rend une salle **visible**,
 * et son parcours **transmissible**.
 *
 * ## Il porte le parcours, et c'est ce que ça coûte
 *
 * Qui ouvre une salle y dépose son tracé ; qui la rejoint le récupère et roule
 * aussitôt, sans avoir jamais eu le fichier. C'est la seule façon de tenir la
 * promesse « rejoindre X sur son parcours », et elle a un prix qu'il faut dire
 * en face plutôt que cacher : un GPX de sortie part souvent du domicile de
 * celui qui l'a enregistré, et **tout occupant du salon peut le télécharger**.
 * L'interface le signale au moment d'ouvrir ; personne ne dépose sa trace sans
 * l'avoir lu.
 *
 * ## Un seul objet, et rien sur disque
 *
 * Une instance unique (`idFromName('lobby')`) : un annuaire n'a de sens que
 * s'il est le même pour tout le monde. Elle vit donc à un seul endroit du
 * globe, ce qui ajoute un aller-retour à ceux qui en sont loin — sans
 * importance pour une liste relue toutes les cinq secondes, rédhibitoire pour
 * des positions, qui restent dans leur propre salle.
 *
 * Rien n'est écrit sur disque, contrairement à ce qu'on attendrait d'un
 * annuaire, et c'est la décision à ne pas défaire par inadvertance :
 * **l'hôte est ce qui maintient sa salle en vie**. Il se réannonce toutes les
 * trente secondes, et une entrée qu'on cesse de rafraîchir s'efface d'elle-même
 * — ce qui fait disparaître la salle de qui a fermé son onglet sans prévenir,
 * cas autrement plus fréquent qu'une instance recyclée. Et si la plateforme
 * recycle tout de même celle-ci, elle se reconstruit seule à l'annonce
 * suivante, sans qu'aucun état périmé ne survive.
 *
 * Corollaire : le tracé n'est envoyé qu'une fois, à l'ouverture. Les
 * réannonces ne portent que les métadonnées ; si l'annuaire a été reconstruit
 * entre-temps et ne connaît plus le tracé, il répond `needsRoute` et l'hôte le
 * renvoie. Sans ce détour, chaque hôte téléverserait son GPX deux fois par
 * minute pour rien.
 */

/** Passé ce délai sans réannonce, l'hôte est parti. Trois fois sa période :
 *  une annonce perdue ne doit pas faire clignoter la salle. */
const ROOM_TTL_MS = 90_000;
/** Un salon entre amis, pas un catalogue. Au-delà, la plus ancienne sort. */
const MAX_OPEN_ROOMS = 50;
/** Au-delà, ce n'est plus une sortie à vélo. */
const MAX_ROUTE_POINTS = 20_000;
/** Longueurs d'affichage : celle d'un pseudo, celle d'un nom de parcours. */
const MAX_HOST_LENGTH = 24;
const MAX_NAME_LENGTH = 120;
/** Au-delà, la valeur est aberrante et non pas seulement surprenante. */
const MAX_DISTANCE_M = 2_000_000;

/*
 * Le site est servi depuis un autre domaine que ce Worker : sans ces en-têtes,
 * le navigateur refuse la lecture du salon. La WebSocket des positions, elle,
 * n'y est pas soumise — c'est pourquoi la question ne s'était pas encore posée.
 * L'origine est ouverte parce que la liste est publique par construction et
 * qu'aucune requête ne porte de témoin d'authentification.
 */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS },
  });
}

export class Lobby {
  constructor() {
    /** @type {Map<string, {host:string, name:string, distanceM:number, openedAt:number, touchedAt:number, coords:Array}>} */
    this.rooms = new Map();
  }

  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);
    const match = url.pathname.match(/^\/lobby(?:\/([A-Za-z0-9_-]{1,64}))?$/);
    if (!match) return json({ error: 'introuvable' }, 404);
    const id = match[1] || null;

    // Avant de répondre quoi que ce soit : une salle périmée ne doit ni
    // s'afficher, ni se laisser rejoindre.
    this.prune();

    if (!id) {
      if (request.method !== 'GET') return json({ error: 'méthode inattendue' }, 405);
      return json({ rooms: this.list() });
    }
    if (request.method === 'GET') return this.serveRoute(id);
    if (request.method === 'POST') return this.announce(id, request);
    if (request.method === 'DELETE') {
      this.rooms.delete(id);
      return json({ ok: true });
    }
    return json({ error: 'méthode inattendue' }, 405);
  }

  /** La liste affichable : tout sauf les tracés, qui pèsent mille fois plus. */
  list() {
    return [...this.rooms.entries()]
      .sort((a, b) => b[1].openedAt - a[1].openedAt)
      .map(([id, room]) => ({
        id,
        host: room.host,
        name: room.name,
        distanceM: room.distanceM,
        openedAt: room.openedAt,
      }));
  }

  serveRoute(id) {
    const room = this.rooms.get(id);
    if (!room) return json({ error: 'salle inconnue' }, 404);
    return json({ id, host: room.host, name: room.name, distanceM: room.distanceM, coords: room.coords });
  }

  async announce(id, request) {
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ error: 'corps illisible' }, 400);
    }

    const existing = this.rooms.get(id);
    let coords = existing?.coords ?? null;
    if (body?.coords !== undefined) {
      coords = cleanCoords(body.coords);
      if (!coords) return json({ error: 'tracé inexploitable' }, 400);
    }
    // L'hôte n'envoie son tracé qu'à l'ouverture. Si l'annuaire a été
    // reconstruit depuis, le lui redemander vaut mieux qu'une salle qu'on voit
    // sans pouvoir la rejoindre.
    if (!coords) return json({ ok: false, needsRoute: true });

    const now = Date.now();
    this.rooms.set(id, {
      host: cleanText(body?.host, MAX_HOST_LENGTH, 'anonyme'),
      name: cleanText(body?.name, MAX_NAME_LENGTH, 'Parcours'),
      distanceM: Math.max(0, Math.min(MAX_DISTANCE_M, Number(body?.distanceM) || 0)),
      // L'heure d'ouverture survit aux réannonces : c'est elle qui ordonne la
      // liste, et une salle ne doit pas remonter en tête toutes les trente
      // secondes.
      openedAt: existing?.openedAt ?? now,
      touchedAt: now,
      coords,
    });
    this.cap();
    return json({ ok: true });
  }

  prune() {
    const cutoff = Date.now() - ROOM_TTL_MS;
    for (const [id, room] of this.rooms) {
      if (room.touchedAt < cutoff) this.rooms.delete(id);
    }
  }

  /** La plus ancienne ouverture sort : celle qui a déjà eu son heure. */
  cap() {
    while (this.rooms.size > MAX_OPEN_ROOMS) {
      let oldest = null;
      for (const entry of this.rooms) {
        if (!oldest || entry[1].openedAt < oldest[1].openedAt) oldest = entry;
      }
      this.rooms.delete(oldest[0]);
    }
  }
}

/** Même nettoyage que les pseudos ailleurs : les caractères de contrôle
 *  brouillent un affichage, et un nom de dix mille caractères n'est pas un nom. */
function cleanText(value, max, fallback) {
  const cleaned = String(value ?? '')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .trim()
    .slice(0, max);
  return cleaned || fallback;
}

/**
 * Borne un tracé reçu — un tableau plat de triplets `lng, lat, ele`, la forme
 * que `library.packPoints` produit côté client.
 *
 * Tout est refusé en bloc plutôt que corrigé point par point : un tracé dont
 * une coordonnée est aberrante n'est pas un tracé un peu abîmé, c'est autre
 * chose, et la scène 3D de celui qui le recevrait n'a aucune défense contre
 * une position à l'autre bout de la Terre.
 *
 * @returns {Array|null}
 */
function cleanCoords(value) {
  if (!Array.isArray(value) || value.length < 6 || value.length % 3 !== 0) return null;
  if (value.length / 3 > MAX_ROUTE_POINTS) return null;

  const coords = new Array(value.length);
  for (let i = 0; i < value.length; i += 3) {
    const lng = Number(value[i]);
    const lat = Number(value[i + 1]);
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return null;
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null;
    const ele = Number(value[i + 2]);
    coords[i] = lng;
    coords[i + 1] = lat;
    // Une altitude inconnue est `null` — et non zéro, qui serait une altitude.
    coords[i + 2] = value[i + 2] == null || !Number.isFinite(ele) ? null : ele;
  }
  return coords;
}
