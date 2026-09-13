/*
 * useRoom — la salle : une connexion, un parcours, quelques coureurs.
 * ---------------------------------------------------------------------
 *
 * ## Ce que le serveur fait, et surtout ce qu'il ne fait pas
 *
 * Il recopie. Un client publie sa position quatre fois par seconde, le serveur
 * la répète aux autres occupants de la salle, et c'est tout : aucune simulation,
 * aucun arbitrage, aucune autorité sur la distance. Le client la possède déjà —
 * c'est la règle qui structure tout le jeu (cf. `CLAUDE.md`), et le multijoueur
 * ne la reprend pas au serveur sous prétexte qu'il existe enfin.
 *
 * Conséquence directe : **c'est trichable**. Annoncer 90 km/h suffit. C'est
 * acceptable entre gens qui se connaissent, et l'interface doit le dire ; ce ne
 * serait pas acceptable pour un classement public.
 *
 * ## Sans serveur configuré, il ne se passe rien
 *
 * `VITE_RACE_SERVER` absent, l'application reste exactement ce qu'elle était :
 * une séance solo. C'est un choix — le déploiement statique n'a besoin de rien,
 * et le multijoueur est la première fonction du projet qui coûte de
 * l'infrastructure (cf. `docs/multijoueur.md`).
 *
 * ## Deux rythmes, et une boucle qui n'est pas celle du jeu
 *
 * La publication se fait sur un `setInterval` et non dans la boucle de rendu.
 * Ce n'est pas une seconde horloge de jeu — rien ici ne fait avancer la
 * séance —, c'est une cadence de réseau : quatre fois par seconde, quoi qu'il
 * arrive à la fréquence d'images. Un onglet mis en arrière-plan continue donc
 * d'annoncer sa présence, avec une position figée : c'est exactement ce que
 * font ses jambes.
 *
 * Le classement, lui, est réactif et ne se rafraîchit que deux fois par
 * seconde : c'est du texte, personne ne lit un écart au décimètre près.
 * Les positions, elles, ne passent jamais par la réactivité de Vue —
 * `getParticipations()` est lue à chaque image par la scène.
 */

import { ref, shallowRef, watch, onBeforeUnmount } from 'vue';
import {
  encodeState,
  parseMessage,
  routeFingerprint,
  sanitizeName,
  PUBLISH_INTERVAL_MS,
} from '@/lib/race/protocol.js';
import { createPeloton } from '@/lib/race/peloton.js';

/** Rafraîchissement du classement affiché. */
const STANDINGS_INTERVAL_MS = 500;
/** Reconnexion : on double à chaque échec, sans dépasser ce délai. */
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 15000;

/** Le pseudo est retenu d'une séance à l'autre : personne n'a envie de le
 *  retaper à chaque fois qu'il change de parcours. */
const NAME_KEY = 'riderName';

/** `localStorage` peut lever à la simple lecture (navigation privée stricte). */
function storedName() {
  try {
    return localStorage.getItem(NAME_KEY) || '';
  } catch (e) {
    return '';
  }
}

/** Adresse du serveur de salles, `ws://` ou `wss://`. */
function serverUrl() {
  const configured = import.meta.env?.VITE_RACE_SERVER;
  if (!configured) return null;
  return String(configured).trim().replace(/^http/, 'ws').replace(/\/+$/, '');
}

export function useRoom() {
  const configured = !!serverUrl();
  /** `off` | `connecting` | `connected` | `retrying` */
  const status = ref('off');
  const roomId = ref(null);
  const riderCount = ref(0);
  const standings = shallowRef([]);
  /** Vrai dès qu'au moins une trame est arrivée : c'est ce qui justifie
   *  d'afficher le classement plutôt qu'un panneau vide. */
  const live = ref(false);
  /** Pseudo affiché aux autres. Retenu par le navigateur, jamais envoyé ailleurs. */
  const name = ref(storedName());

  watch(name, (value) => {
    try {
      localStorage.setItem(NAME_KEY, value);
    } catch (e) {
      // Ne pas pouvoir retenir un pseudo n'empêche pas de rouler avec.
    }
  });

  // --- Non réactif ---------------------------------------------------------
  let socket = null;
  let peloton = null;
  let publishTimer = null;
  let standingsTimer = null;
  let retryTimer = null;
  let retryDelay = RETRY_MIN_MS;
  let joined = null; // { fingerprint, name }
  let selfId = null;
  let getSnapshot = null;

  /**
   * Branche la source d'état local. Une fonction, lue au rythme du réseau :
   * la séance n'a pas à savoir qu'elle est diffusée.
   *
   * @param {() => {distanceM:number, routeDistanceM:number, powerW:number, speedMs:number, laps:number}} source
   */
  function attach(source) {
    getSnapshot = source;
  }

  /**
   * Entre dans la salle d'un parcours.
   *
   * @param {Object} options
   * @param {import('@/lib/riderScene/routePath.js').RoutePath} options.path
   */
  function join({ path }) {
    leave();
    const base = serverUrl();
    const fingerprint = routeFingerprint(path);
    if (!base || !fingerprint || !path) return;

    peloton = createPeloton({ path });
    joined = { fingerprint, name: sanitizeName(name.value) };
    roomId.value = fingerprint;
    retryDelay = RETRY_MIN_MS;
    open();

    publishTimer = setInterval(publish, PUBLISH_INTERVAL_MS);
    standingsTimer = setInterval(refreshStandings, STANDINGS_INTERVAL_MS);
  }

  function open() {
    const base = serverUrl();
    if (!base || !joined) return;
    status.value = status.value === 'retrying' ? 'retrying' : 'connecting';

    let opened;
    try {
      opened = new WebSocket(`${base}/room/${joined.fingerprint}`);
      socket = opened;
    } catch (e) {
      console.warn('[room] connexion impossible', e?.message || e);
      scheduleRetry();
      return;
    }

    /*
     * Une connexion remplacée continue d'émettre ses événements : sa fermeture
     * arrive après que la suivante est ouverte. Chaque écouteur vérifie donc
     * qu'il parle encore de la connexion en cours — sans quoi le `close` d'une
     * ancienne viendrait fermer la nouvelle, en quittant puis rejoignant
     * aussitôt une salle.
     */
    const current = () => socket === opened;

    opened.addEventListener('open', () => {
      if (!current()) return;
      status.value = 'connected';
      retryDelay = RETRY_MIN_MS;
      send({ t: 'join', name: joined.name });
    });

    opened.addEventListener('message', (event) => {
      // Une trame en retard sur un départ : il n'y a plus de peloton à nourrir.
      if (!current() || !peloton) return;
      const message = parseMessage(event.data);
      if (!message) return;
      const now = performance.now();

      if (message.type === 'hello') {
        selfId = message.id;
        // La salle n'est pas vide à l'arrivée : les occupants sont placés tout
        // de suite, sans attendre leur prochaine diffusion.
        for (const rider of message.riders) {
          if (rider.id !== selfId) peloton.push(rider, now);
        }
        live.value = true;
      } else if (message.type === 'state') {
        if (message.id === selfId) return; // notre propre écho
        peloton.push(message, now);
        live.value = true;
      } else if (message.type === 'gone') {
        peloton.remove(message.id);
      }
      riderCount.value = peloton.size;
    });

    opened.addEventListener('close', () => {
      if (!current()) return;
      socket = null;
      // Une salle quittée volontairement n'a plus de `joined` : rien à rouvrir.
      if (joined) scheduleRetry();
    });

    opened.addEventListener('error', () => {
      if (!current()) return;
      // `error` est toujours suivi de `close` : la reconnexion se décide
      // là-bas, une seule fois.
      console.warn('[room] liaison interrompue');
    });
  }

  function scheduleRetry() {
    if (!joined || retryTimer) return;
    status.value = 'retrying';
    /*
     * Les coureurs restés dans le peloton se périment d'eux-mêmes pendant la
     * coupure, et c'est ce qu'il faut : on ne sait plus rien d'eux, mieux vaut
     * les voir disparaître que les laisser rouler sur une position morte.
     */
    retryTimer = setTimeout(() => {
      retryTimer = null;
      open();
    }, retryDelay);
    retryDelay = Math.min(RETRY_MAX_MS, retryDelay * 2);
  }

  function send(message) {
    if (socket?.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify(message));
    } catch (e) {
      console.warn('[room] envoi impossible', e?.message || e);
    }
  }

  function publish() {
    if (!peloton) return;
    // Les absents sont retirés au rythme du réseau, pas à celui des images :
    // une péremption est un fait de réseau.
    if (peloton.prune(performance.now()) > 0) riderCount.value = peloton.size;

    const snapshot = getSnapshot?.();
    if (!snapshot) return;
    send(encodeState(snapshot));
  }

  function refreshStandings() {
    if (!peloton) return;
    const snapshot = getSnapshot?.();
    standings.value = peloton.standings(
      snapshot
        ? {
            id: selfId || 'self',
            name: joined?.name || '',
            distanceM: snapshot.distanceM,
            powerW: snapshot.powerW,
          }
        : null
    );
  }

  /** Quitte la salle. Le `bye` est une politesse : la fermeture suffit. */
  function leave() {
    joined = null;
    selfId = null;
    if (publishTimer) clearInterval(publishTimer);
    if (standingsTimer) clearInterval(standingsTimer);
    if (retryTimer) clearTimeout(retryTimer);
    publishTimer = standingsTimer = retryTimer = null;
    try {
      socket?.close();
    } catch (e) {
      /* une connexion déjà morte n'a pas à être refermée proprement */
    }
    socket = null;
    peloton = null;
    roomId.value = null;
    riderCount.value = 0;
    standings.value = [];
    live.value = false;
    status.value = 'off';
  }

  onBeforeUnmount(leave);

  return {
    /** Vrai quand un serveur de salles est configuré. */
    configured,
    status,
    name,
    roomId,
    riderCount,
    standings,
    live,
    attach,
    join,
    leave,
    /** Lue à chaque image par la scène. Jamais rendue réactive. */
    getParticipations: () => peloton?.participations() ?? [],
  };
}
