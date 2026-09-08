/*
 * library — les parcours que le joueur a lui-même déposés.
 * ---------------------------------------------------------------------
 *
 * Un parcours livré avec l'application est un fichier dans `public/routes/`.
 * Un parcours **déposé** ne peut pas l'être : il arrive dans le navigateur, et
 * il doit y rester. Ce module tient ce dépôt-là.
 *
 * ## Ce qui est rangé, et ce qui ne l'est pas
 *
 * On garde les coordonnées **brutes** — longitude, latitude, altitude telles
 * que le GPX les portait — et non le tracé prêt à l'emploi. Deux raisons :
 *
 * - le tracé se recalcule en quelques millisecondes, alors que le stocker
 *   doublerait le volume (l'abscisse cumulée est déductible) ;
 * - surtout, la **fenêtre de lissage de l'altitude** est un réglage du moteur,
 *   pas une propriété du fichier. Le jour où on la corrige, les parcours déjà
 *   déposés doivent en bénéficier — ce qui n'arriverait pas si on avait figé
 *   des altitudes lissées.
 *
 * ## Le volume
 *
 * `localStorage` plafonne autour de 5 Mo par origine, et c'est un plafond
 * partagé avec tout le reste. Les coordonnées sont donc arrondies à ce que la
 * précision utile exige — six décimales valent une dizaine de centimètres, très
 * au-delà de ce qu'un GPS de vélo distingue — et le nombre de parcours gardés
 * est borné. Un dépassement de quota n'est pas une erreur fatale : le parcours
 * reste utilisable pour la séance en cours, il n'est simplement pas retenu.
 *
 * Module pur : `localStorage` lui est **passé**, jamais lu depuis un global.
 * C'est ce qui permet de le tester sous `node --test`, et de survivre à un
 * navigateur en navigation privée qui lève à la moindre écriture.
 */

export const STORAGE_KEY = 'routeLibrary';
export const STORAGE_VERSION = 1;

/** Au-delà, les plus anciens sortent. Un plafond, pas une promesse. */
export const MAX_ROUTES = 12;

/** Six décimales ≈ 11 cm : bien plus fin que ce qu'un GPS de vélo distingue. */
const COORD_DECIMALS = 6;
const ELEVATION_DECIMALS = 1;

const round = (value, decimals) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/**
 * Aplatit les points en un tableau de nombres : trois par point, sans objets.
 * Un tableau plat sérialisé pèse environ moitié moins que la même chose en
 * objets nommés, et c'est le seul endroit où cela se voit.
 *
 * Une altitude inconnue est écrite `null` — et non zéro, qui serait une
 * altitude, ni `NaN`, que JSON ne sait pas transporter.
 */
export function packPoints(points) {
  const flat = [];
  for (const point of points) {
    flat.push(round(point.lng, COORD_DECIMALS), round(point.lat, COORD_DECIMALS));
    flat.push(point.ele == null || !Number.isFinite(point.ele) ? null : round(point.ele, ELEVATION_DECIMALS));
  }
  return flat;
}

/** L'inverse de `packPoints`. Tolère un tableau tronqué : on s'arrête au dernier triplet complet. */
export function unpackPoints(flat) {
  if (!Array.isArray(flat)) return [];
  const points = [];
  for (let i = 0; i + 2 < flat.length; i += 3) {
    const lng = Number(flat[i]);
    const lat = Number(flat[i + 1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    const ele = flat[i + 2];
    points.push({ lng, lat, ele: Number.isFinite(ele) ? Number(ele) : null });
  }
  return points;
}

/**
 * Identifiant stable tiré du nom : deux dépôts du même fichier remplacent au
 * lieu de s'empiler. C'est ce qu'on attend en corrigeant un GPX et en le
 * redéposant.
 */
export function routeIdFor(name) {
  const slug = String(name || 'parcours')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // les diacritiques, isolées par NFD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `import-${slug || 'parcours'}`;
}

/**
 * Lit le dépôt. Ne lève jamais : un stockage illisible (navigation privée,
 * quota, JSON corrompu, version future) rend un dépôt vide, ce qui laisse
 * l'application démarrer.
 *
 * @param {Storage|null} storage
 * @returns {Array<{id:string, name:string, loop:boolean, importedAt:number, coords:Array}>}
 */
export function readLibrary(storage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (parsed?.v !== STORAGE_VERSION || !Array.isArray(parsed.routes)) return [];
    return parsed.routes.filter((route) => route?.id && Array.isArray(route.coords));
  } catch (e) {
    console.warn('[library] dépôt illisible, on repart à vide', e?.message || e);
    return [];
  }
}

/**
 * Écrit le dépôt, en gardant les plus récents.
 *
 * @returns {boolean} faux si l'écriture n'a pas pu se faire — quota dépassé,
 *          navigation privée. L'appelant garde alors son parcours en mémoire
 *          pour la séance : ne pas pouvoir le retenir n'est pas une raison de
 *          refuser de rouler.
 */
export function writeLibrary(storage, routes) {
  const kept = [...routes]
    .sort((a, b) => (b.importedAt || 0) - (a.importedAt || 0))
    .slice(0, MAX_ROUTES);
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify({ v: STORAGE_VERSION, routes: kept }));
    return true;
  } catch (e) {
    console.warn('[library] parcours non retenu (quota ou stockage indisponible)', e?.message || e);
    return false;
  }
}

/**
 * Range un parcours de plus, et rend le dépôt à jour.
 *
 * @returns {{routes: Array, stored: boolean}} `stored` dit si l'écriture a
 *          abouti — voir `writeLibrary`.
 */
export function addToLibrary(storage, { name, loop, points }) {
  const entry = {
    id: routeIdFor(name),
    name: String(name || 'Parcours importé').slice(0, 120),
    loop: !!loop,
    importedAt: Date.now(),
    coords: packPoints(points),
  };
  const routes = readLibrary(storage).filter((route) => route.id !== entry.id);
  routes.push(entry);
  return { routes, stored: writeLibrary(storage, routes) };
}

export function removeFromLibrary(storage, id) {
  const routes = readLibrary(storage).filter((route) => route.id !== id);
  writeLibrary(storage, routes);
  return routes;
}
