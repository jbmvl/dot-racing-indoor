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
import { readLibrary, addToLibrary, removeFromLibrary, unpackPoints } from '@/lib/route/library.js';

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
    if (!/\.gpx$/i.test(file?.name || '')) throw new Error('ce n’est pas un fichier .gpx');
    const { name, points } = await readGpxFile(file);
    const { routes: next, stored } = addToLibrary(storage, { name, loop, points });
    imported.value = next;
    lastImportVolatile.value = !stored;
    const entry = next.find((route) => route.name === name);
    return { id: entry.id, name: entry.name, loop: entry.loop, imported: true };
  }

  function remove(id) {
    imported.value = removeFromLibrary(storage, id);
  }

  return { routes, imported, lastImportVolatile, resolve, importFile, remove };
}
