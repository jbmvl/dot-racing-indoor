/*
 * room — le serveur de salles : un Durable Object par parcours.
 * ---------------------------------------------------------------------
 *
 * Il recopie, et rien d'autre. Un client publie sa position quatre fois par
 * seconde, ce serveur la répète aux autres occupants de la salle. Aucune
 * simulation, aucun arbitrage, aucune autorité sur la distance : **le client
 * possède la sienne**, c'est la règle qui structure tout le jeu, et le
 * multijoueur ne la lui reprend pas sous prétexte qu'un serveur existe enfin.
 *
 * Conséquence à dire, pas à cacher : c'est **trichable**. Annoncer 90 km/h
 * suffit. C'est acceptable entre gens qui se connaissent, et l'interface le
 * dit ; ce ne serait pas acceptable pour un classement public.
 *
 * ## Pourquoi un Durable Object
 *
 * Une salle est un état partagé par quelques connexions, qui doit vivre tant
 * qu'elles roulent et disparaître après. C'est exactement la forme d'un Durable
 * Object : une instance par nom — ici, l'empreinte du parcours —, et toutes les
 * connexions d'une même salle atterrissent dans la même. Une fonction
 * sans état ne peut pas tenir une connexion ouverte, et un serveur classique
 * demanderait un hôte à surveiller (cf. `docs/multijoueur.md`).
 *
 * ## Ce qui est gardé en mémoire, et pourquoi si peu
 *
 * Le dernier état de chacun, et c'est tout. Il sert à une seule chose : donner
 * à celui qui arrive la position des autres **tout de suite**, au lieu d'un
 * quart de seconde de peloton vide. Rien n'est écrit sur disque : une séance
 * qui s'interrompt n'a rien à reprendre, chacun repart de sa propre distance.
 *
 * Déploiement : `npx wrangler deploy` depuis ce dossier. Aucune dépendance npm.
 */

/** Au-delà, ce n'est plus une salle entre amis. La scène n'en montre que dix. */
const MAX_RIDERS = 32;
/** Un client qui publie plus vite que ça n'est pas un client de ce jeu. */
const MAX_MESSAGES_PER_SECOND = 20;
/** Une trame d'état fait une centaine d'octets ; le reste est suspect. */
const MAX_MESSAGE_BYTES = 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/room\/([A-Za-z0-9_-]{1,64})$/);

    if (!match) {
      return new Response('dot-racing-indoor — serveur de salles\n', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('connexion websocket attendue\n', { status: 426 });
    }

    // Le nom de la salle est l'empreinte du parcours : deux clients qui ont le
    // même GPX tombent sur le même objet, où qu'ils soient dans le monde.
    const room = env.ROOMS.get(env.ROOMS.idFromName(match[1]));
    return room.fetch(request);
  },
};

export class Room {
  constructor(state) {
    this.state = state;
    /** @type {Map<WebSocket, {id:string, name:string, last:Object|null, window:{since:number, count:number}}>} */
    this.sessions = new Map();
  }

  async fetch() {
    if (this.sessions.size >= MAX_RIDERS) {
      return new Response('salle pleine\n', { status: 503 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    const session = {
      id: crypto.randomUUID().slice(0, 8),
      name: 'anonyme',
      last: null,
      window: { since: Date.now(), count: 0 },
    };
    this.sessions.set(server, session);

    server.addEventListener('message', (event) => this.onMessage(server, session, event));
    // Fermeture et panne mènent au même endroit : quelqu'un est parti. Le
    // distinguer n'apprendrait rien à ceux qui restent.
    server.addEventListener('close', () => this.onLeave(server, session));
    server.addEventListener('error', () => this.onLeave(server, session));

    return new Response(null, { status: 101, webSocket: client });
  }

  onMessage(socket, session, event) {
    if (typeof event.data !== 'string' || event.data.length > MAX_MESSAGE_BYTES) return;

    // Fenêtre glissante d'une seconde : un client trop bavard est ignoré, pas
    // déconnecté — un hoquet de sa part ne mérite pas de le sortir de la course.
    const now = Date.now();
    if (now - session.window.since >= 1000) {
      session.window.since = now;
      session.window.count = 0;
    }
    if (++session.window.count > MAX_MESSAGES_PER_SECOND) return;

    let message;
    try {
      message = JSON.parse(event.data);
    } catch (e) {
      return;
    }

    if (message?.t === 'join') {
      session.name = cleanName(message.name);
      this.send(socket, {
        t: 'hello',
        id: session.id,
        // L'état des autres, tel qu'on l'a reçu : celui qui arrive voit un
        // peloton en place plutôt qu'une route vide le temps d'une diffusion.
        riders: [...this.sessions.values()]
          .filter((other) => other !== session && other.last)
          .map((other) => ({ ...other.last, id: other.id, name: other.name })),
      });
      return;
    }

    if (message?.t === 'at') {
      // Le serveur ne relit pas les nombres : il ne saurait pas quoi en penser
      // sans refaire la simulation, et c'est justement ce qu'il ne fait pas.
      // Le bornage est à l'arrivée, chez ceux qui affichent (cf. `protocol.js`).
      session.last = { t: 'at', d: message.d, r: message.r, w: message.w, v: message.v, l: message.l };
      this.broadcast({ ...session.last, id: session.id, name: session.name }, socket);
    }
  }

  onLeave(socket, session) {
    if (!this.sessions.delete(socket)) return;
    this.broadcast({ t: 'gone', id: session.id }, socket);
  }

  send(socket, message) {
    try {
      socket.send(JSON.stringify(message));
    } catch (e) {
      // Une connexion morte se découvre à l'écriture : elle sera retirée par
      // son propre événement de fermeture.
    }
  }

  broadcast(message, except = null) {
    const payload = JSON.stringify(message);
    for (const socket of this.sessions.keys()) {
      if (socket === except) continue;
      try {
        socket.send(payload);
      } catch (e) {
        /* cf. `send` */
      }
    }
  }
}

/** Même nettoyage que côté client : les caractères de contrôle brouillent un
 *  classement, et un pseudo de dix mille caractères n'est pas un pseudo. */
function cleanName(name) {
  const cleaned = String(name ?? '')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .trim()
    .slice(0, 24);
  return cleaned || 'anonyme';
}
