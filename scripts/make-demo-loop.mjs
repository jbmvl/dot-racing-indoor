/*
 * Fabrique le parcours de démonstration `public/routes/boucle-demo.gpx`.
 *
 * **Ce tracé est synthétique et provisoire.** C'est un cercle posé sur la
 * campagne vauclusienne, avec un profil d'altitude inventé : il ne suit aucune
 * route, et le coureur traversera donc des champs. Il n'existe que pour donner
 * au lot 1 quelque chose à faire défiler, et pour que le modèle physique du lot
 * 3 ait une pente à mouliner. Le lot 2 le remplace par un vrai GPX — et rien
 * d'autre ne changera, puisque tout le monde ne lit que `buildRoutePath`.
 *
 *   node scripts/make-demo-loop.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';

/** Centre de la boucle : campagne autour de Vaison-la-Romaine (Vaucluse). */
const CENTRE = { lng: 5.0747, lat: 44.2405 };
const RADIUS_M = 800;
const POINTS = 360;
/** Deux bosses par tour, ±35 m : de quoi voir la pente agir sans être absurde. */
const HILL_AMPLITUDE_M = 35;
const BASE_ELEVATION_M = 290;

const EARTH_RADIUS_M = 6371008.8;
const DEG = Math.PI / 180;

const points = [];
for (let i = 0; i <= POINTS; i++) {
  // Le dernier point retombe exactement sur le premier : la boucle se referme.
  const angle = (i % POINTS) * ((Math.PI * 2) / POINTS);
  const north = Math.cos(angle) * RADIUS_M;
  const east = Math.sin(angle) * RADIUS_M;
  const lat = CENTRE.lat + (north / EARTH_RADIUS_M) / DEG;
  const lng = CENTRE.lng + (east / EARTH_RADIUS_M) / DEG / Math.cos(CENTRE.lat * DEG);
  const ele = BASE_ELEVATION_M + Math.sin(angle * 2) * HILL_AMPLITUDE_M;
  points.push(
    `      <trkpt lat="${lat.toFixed(7)}" lon="${lng.toFixed(7)}"><ele>${ele.toFixed(1)}</ele></trkpt>`
  );
}

const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="dot-racing-indoor/scripts/make-demo-loop.mjs" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>Boucle de démonstration</name>
    <desc>Tracé SYNTHÉTIQUE : un cercle de ${RADIUS_M} m de rayon, altitude inventée. Ne suit aucune route. À remplacer par un vrai GPX.</desc>
  </metadata>
  <trk>
    <name>Boucle de démonstration</name>
    <trkseg>
${points.join('\n')}
    </trkseg>
  </trk>
</gpx>
`;

mkdirSync('public/routes', { recursive: true });
writeFileSync('public/routes/boucle-demo.gpx', gpx);
console.log(`écrit public/routes/boucle-demo.gpx — ${POINTS} points, ~${Math.round((2 * Math.PI * RADIUS_M) / 100) / 10} km`);
