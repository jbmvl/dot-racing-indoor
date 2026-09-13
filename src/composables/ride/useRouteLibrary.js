/*
 * useRouteLibrary — la liste des parcours disponibles, livrés et déposés.
 * ---------------------------------------------------------------------
 *
 * Deux origines, une seule liste : les parcours livrés avec l'application
 * (`catalog.js`, servis depuis `public/routes/`) et ceux que le joueur a
 * déposés (`library.js`, rangés dans le navigateur). Le reste de
 * l'application ne fait pas la différence — elle ne voit que des descripteurs
 * et demande un tracé par identifiant.
 *
 * C'est ce qui permet d'utiliser n'importe quel GPX sans passer par un commit :
 * on le dépose, il est là.
 */

import { ref, computed } from 'vue';
import { ROUTES, findRoute, loadRoute, pathFromRawPoints, readGpxFile } from '@/lib/route/catalog.js';
import { readLibrary, addToLibrary, removeFromLibrary, routeIdFor, unpackPoints } from '@/lib/route/library.js';

/** `localStorage` peut lever à la simple lecture (navigation privée stricte). */
function safeStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch (e) {
    return null;
  }
}

export function useRouteLibrary() {
  const storage = safeStorage();
  const imported = ref(readLibrary(storage));
  /** Vrai quand un parcours n'a pas pu être retenu (quota, navigation privée). */
  const lastImportVolatile = ref(false);

  const routes = computed(() => [
    ...ROUTES,
    ...imported.value.map((entry) => ({
      id: entry.id,
      name: entry.name,
      loop: entry.loop,
      imported: true,
      importedAt: entry.importedAt,
    })),
  ]);

  /**
   * Rend le tracé d'un parcours, quelle que soit son origine.
   * @returns {Promise<{descriptor: Object, path: Object}>}
   */
  async function resolve(id) {
    const entry = imported.value.find((route) => route.id === id);
    if (entry) {
      return {
        descriptor: { id: entry.id, name: entry.name, loop: entry.loop, imported: true },
        path: pathFromRawPoints(unpackPoints(entry.coords)),
      };
    }
    return loadRoute(findRoute(id));
  }

  /**
   * Dépose un fichier GPX.
   *
   * Le fichier est lu, validé et rangé. S'il ne peut pas être retenu — quota
   * atteint, stockage indisponible — il reste utilisable pour la séance en
   * cours : ne pas pouvoir mémoriser un parcours n'est pas une raison de
   * refuser de rouler dessus. `lastImportVolatile` le signale à l'interface.
   *
   * @param {File} file
   * @param {Object} [options]
   * @param {boolean} [options.loop] Le parcours se reboucle.
   * @returns {Promise<Object>} le descripteur du parcours déposé.
   */
  async function importFile(file, { loop = true } = {}) {
    /*
     * On ne filtre pas sur l'extension. Un parcours téléchargé arrive
     * volontiers en `.xml`, sans extension, ou renommé par le navigateur — et
     * refuser sur le nom priverait le joueur d'un fichier parfaitement
     * lisible. Le seul juge est le contenu : `readGpxFile` lève si la trace
     * n'est pas exploitable, et c'est ce message-là qui est utile.
     */
    const { name, points } = await readGpxFile(file);
    return addRoute({ name, points, loop });
  }

  /**
   * Range un parcours déjà lu, sans passer par un fichier.
   *
   * C'est par là qu'entre le tracé qu'un salon transmet : rejoindre la salle de
   * quelqu'un donne son parcours, et il se range comme n'importe quel autre —
   * l'invité le garde, le revoit dans sa liste et peut y revenir seul.
   *
   * @param {Object} route
   * @param {Array<{lng:number, lat:number, ele:number|null}>} route.points points bruts.
   */
  function addRoute({ name, points, loop = true }) {
    const { routes: next, stored } = addToLibrary(storage, { name, loop, points });
    imported.value = next;
    lastImportVolatile.value = !stored;
    // Retrouvé par identifiant et non par nom : `addToLibrary` tronque les noms
    // longs, et la comparaison sur le nom d'origine ne trouverait alors rien.
    const entry = next.find((route) => route.id === routeIdFor(name));
    return { id: entry.id, name: entry.name, loop: entry.loop, imported: true };
  }

  /**
   * Les points **bruts** d'un parcours déposé — ce qu'une salle transmet.
   *
   * Ce sont ceux que le dépôt garde, et non ceux du fichier d'origine : c'est
   * sur eux que le tracé est reconstruit à chaque séance, donc ce sont eux qui
   * décident de l'empreinte de salle. Transmettre les autres ferait tomber
   * l'invité dans une salle voisine mais différente (cf. `lib/race/lobby.js`).
   */
  function rawPoints(id) {
    const entry = imported.value.find((route) => route.id === id);
    return entry ? unpackPoints(entry.coords) : null;
  }

  function remove(id) {
    imported.value = removeFromLibrary(storage, id);
  }

  return { routes, imported, lastImportVolatile, resolve, importFile, addRoute, rawPoints, remove };
}
