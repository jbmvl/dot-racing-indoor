/*
 * scene — d'où le décor tient ses données, et à quelle taille il les monte.
 * ---------------------------------------------------------------------
 *
 * Dans Dot Racing, ces réglages se lisaient sur la carte MapLibre qui tournait
 * sous la scène (`vectorSourceConfig.readSourceConfig`). Ici il n'y a pas de
 * carte : la configuration est à nous, et c'est le seul endroit où elle est
 * écrite.
 *
 * On ne code pas en dur un gabarit d'URL de tuiles. Un fournisseur publie un
 * **TileJSON** — c'est lui qui dit le gabarit exact, le zoom maximal et
 * l'attribution, et c'est lui qui change quand le fournisseur change quelque
 * chose. On le lit une fois au démarrage, exactement ce que MapLibre faisait
 * pour nous.
 */

/** TileJSON de la source vectorielle. Schéma OpenMapTiles obligatoire. */
export const VECTOR_TILEJSON_URL =
  import.meta.env?.VITE_VECTOR_TILEJSON ||
  'https://tiles.basemaps.cartocdn.com/vector/carto.streets/v1/tiles.json';

/**
 * Repli si le TileJSON ne répond pas. Le décor se réduit alors au relief nu —
 * un pré à perte de vue, sans routes ni bâtiments. C'est laid, mais ça roule,
 * et c'est préférable à un écran d'erreur.
 */
export const VECTOR_FALLBACK = null;

/** Zoom des tuiles de la bulle. 15 = ~865 m par tuile à nos latitudes. */
export const BUBBLE_ZOOM = 15;

/** Côté du bloc, en tuiles (impair : le coureur est dans la tuile centrale). */
export const BUBBLE_TILES = 3;

/**
 * Mailles par tuile et par côté, anneau par anneau. Au zoom 15 une tuile fait
 * ~850 m : 192 → 4,4 m sous le coureur, 96 → 8,8 m, 48 → 18 m à la bordure.
 * Le MNT Terrarium a 3,3 m de résolution native ; l'anneau central s'en
 * approche, les autres relâchent.
 */
export const BUBBLE_SEGMENTS_BY_RING = [192, 96, 48];

/**
 * Lit le TileJSON et en tire ce que `createWorld` attend.
 *
 * Volontairement tolérant : un fournisseur injoignable ne doit pas empêcher la
 * séance de démarrer. On rend `null`, et l'appelant monte un décor sans
 * vectoriel.
 *
 * @param {string} [url]
 * @param {AbortSignal} [signal]
 * @returns {Promise<{tiles: string[], maxZoom: number, minZoom: number}|null>}
 */
export async function resolveVectorSource(url = VECTOR_TILEJSON_URL, signal = undefined) {
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    const tiles = Array.isArray(json?.tiles) ? json.tiles.filter((t) => typeof t === 'string') : [];
    if (tiles.length === 0) throw new Error('TileJSON sans gabarit de tuiles');
    return {
      tiles,
      maxZoom: Number.isFinite(json.maxzoom) ? json.maxzoom : 14,
      minZoom: Number.isFinite(json.minzoom) ? json.minzoom : 0,
    };
  } catch (e) {
    console.warn(`[scene] source vectorielle indisponible (${e?.message || e}) — relief nu`);
    return VECTOR_FALLBACK;
  }
}
