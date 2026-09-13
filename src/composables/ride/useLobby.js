/*
 * useLobby — la liaison avec le salon : lister, ouvrir, rejoindre.
 * ---------------------------------------------------------------------
 *
 * `useRoom` tient les positions, quatre fois par seconde, sur une WebSocket.
 * Ce module-ci tient tout autre chose : un annuaire relu de loin en loin, en
 * simple HTTP. Les deux parlent au même serveur et ne se connaissent pas — une
 * salle ignore qu'elle est listée, et le peloton continue de rouler si le salon
 * disparaît.
 *
 * ## L'hôte maintient sa salle en vie
 *
 * Rien n'est écrit sur disque côté serveur : une salle annoncée s'efface
 * d'elle-même si personne ne la rafraîchit (cf. `multiplayer/lobby.js`). C'est
 * ce qui fait disparaître la salle de qui a fermé son onglet — le cas courant,
 * qu'aucun message d'adieu ne couvrirait. D'où le `setInterval` : ce n'est pas
 * une horloge de jeu, c'est un signe de vie.
 *
 * Le tracé, lui, ne part qu'à l'ouverture. Si le salon a été reconstruit depuis
 * et ne le connaît plus, il répond `needsRoute` et on le renvoie une fois.
 *
 * ## Un salon injoignable n'empêche pas de rouler
 *
 * Toutes les lectures échouent en silence, vers une liste vide. Le multijoueur
 * est déjà optionnel (`VITE_RACE_SERVER`) ; son annuaire l'est deux fois. Seule
 * l'ouverture d'une salle et la récupération d'un parcours lèvent — là,
 * quelqu'un attend un résultat et doit savoir qu'il n'est pas venu.
 */

import { ref, shallowRef, onBeforeUnmount } from 'vue';
import { lobbyUrl, sanitizeRoom, sanitizeRoomList, roomPoints, roomBody } from '@/lib/race/lobby.js';

/** L'écran d'accueil relit la liste à ce rythme. C'est une liste, pas un jeu. */
const LIST_INTERVAL_MS = 5000;
/** Signe de vie de l'hôte. Le serveur périme au bout du triple. */
const ANNOUNCE_INTERVAL_MS = 30000;

/** Adresse du serveur de salles, `ws://` ou `wss://` — comme dans `useRoom`. */
function serverUrl() {
  const configured = import.meta.env?.VITE_RACE_SERVER;
  if (!configured) return null;
  return String(configured).trim().replace(/^http/, 'ws').replace(/\/+$/, '');
}

export function useLobby({ name }) {
  const configured = !!serverUrl();
  /** Les salles ouvertes, telles que l'écran d'accueil les montre. */
  const rooms = shallowRef([]);
  /** Empreinte de la salle qu'on héberge, ou `null`. */
  const hosting = ref(null);

  // --- Non réactif ---------------------------------------------------------
  let listTimer = null;
  let announceTimer = null;
  let hosted = null; // { fingerprint, name, distanceM, points }

  async function call(path, options) {
    const url = lobbyUrl(serverUrl(), path);
    if (!url) throw new Error('aucun serveur de salles configuré');
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`salon indisponible (HTTP ${response.status})`);
    return response.json();
  }

  /** Relit la liste. Une panne rend une liste vide : la séance solo reste due. */
  async function refresh() {
    try {
      rooms.value = sanitizeRoomList(await call(''));
    } catch (e) {
      rooms.value = [];
    }
  }

  /** Suit les salles ouvertes tant que l'écran d'accueil est affiché. */
  function watch() {
    if (!configured || listTimer) return;
    refresh();
    listTimer = setInterval(refresh, LIST_INTERVAL_MS);
  }

  function unwatch() {
    if (listTimer) clearInterval(listTimer);
    listTimer = null;
  }

  /**
   * Annonce la salle. `withPoints` n'est vrai qu'à l'ouverture — et une fois de
   * plus si le salon a oublié le tracé entre-temps.
   */
  async function announce(withPoints) {
    if (!hosted) return;
    const result = await call(`/${hosted.fingerprint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        roomBody({
          host: name.value,
          name: hosted.name,
          distanceM: hosted.distanceM,
          points: withPoints ? hosted.points : null,
        })
      ),
    });
    // Une seule reprise possible : la suivante porte le tracé, donc le salon
    // ne peut plus le redemander.
    if (result?.needsRoute && !withPoints) await announce(true);
  }

  /**
   * Ouvre une salle sur le parcours en cours, et la maintient en vie.
   *
   * @param {Object} room
   * @param {string} room.fingerprint l'empreinte, telle que `useRoom` l'a retenue.
   * @param {Array<{lng:number, lat:number, ele:number|null}>} room.points points bruts.
   * @returns {Promise<boolean>}
   */
  async function open({ fingerprint, name: routeName, distanceM, points }) {
    close();
    if (!fingerprint || !points?.length) return false;
    hosted = { fingerprint, name: routeName, distanceM, points };
    try {
      await announce(true);
    } catch (e) {
      hosted = null;
      console.warn('[lobby] salle non ouverte', e?.message || e);
      return false;
    }
    hosting.value = fingerprint;
    /*
     * L'échec d'un signe de vie n'annule pas l'hébergement : le salon peut
     * être momentanément injoignable, et la tentative suivante rétablira
     * l'entrée avant que les trente secondes de péremption soient écoulées.
     */
    announceTimer = setInterval(() => {
      announce(false).catch(() => {});
    }, ANNOUNCE_INTERVAL_MS);
    return true;
  }

  /** Ferme la salle. Le `DELETE` est une politesse : elle se périmerait seule. */
  function close() {
    const previous = hosted;
    hosted = null;
    hosting.value = null;
    if (announceTimer) clearInterval(announceTimer);
    announceTimer = null;
    if (previous) call(`/${previous.fingerprint}`, { method: 'DELETE' }).catch(() => {});
  }

  /**
   * Récupère le parcours d'une salle — c'est ce qui permet de rejoindre
   * quelqu'un sans avoir jamais eu son fichier.
   *
   * @returns {Promise<{name:string, points:Array}>}
   */
  async function fetchRoute(fingerprint) {
    const payload = await call(`/${fingerprint}`);
    const room = sanitizeRoom(payload);
    const points = roomPoints(payload);
    if (!room || !points) throw new Error('parcours indisponible');
    return { name: room.name, points };
  }

  onBeforeUnmount(() => {
    unwatch();
    close();
  });

  return { configured, rooms, hosting, watch, unwatch, open, close, fetchRoute };
}
