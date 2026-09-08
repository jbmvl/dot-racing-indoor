/*
 * sceneWeather — traduit la météo du moteur (codes WMO/Open-Meteo) en l'état
 * météo que `worldpaint` attend pour `updateSky` (voir `resolveWeather` dans
 * `environment/weather.js` du dépôt worldpaint).
 * ---------------------------------------------------------------------------
 * Le moteur stocke `participation.statistics.weather` sous la forme brute
 * d'Open-Meteo : un code WMO, une pluie en mm/h, un vent en km/h. worldpaint ne
 * connaît rien de ce format — il attend des coefficients 0..1 par phénomène
 * (couvert, densité, précipitation, vent, brume). Ce module fait exactement
 * cette conversion, et rien d'autre : la nuit reste du ressort de `updateSky`
 * lui-même (position du soleil selon date/lat/lng), pas de cette météo.
 *
 * Absence de météo (participation pas encore chargée, feature désactivée) →
 * on renvoie `undefined`, la valeur que `world.updateSky` interprète comme
 * « rien à changer » : le ciel garde le dernier état météo connu plutôt que de
 * retomber sur `DEFAULT_WEATHER` à chaque trou passager d'une seule tranche.
 */

/** Vent au-delà duquel on considère la bourrasque pleine (km/h). */
const WIND_FULL_KMH = 45;

/**
 * Couvert et densité de base par famille de code WMO, avant modulation par la
 * pluie réelle. Les valeurs couvrent tout l'intervalle 0..99 par tranches —
 * voir la table WMO reprise ailleurs dans le code (`describePastTraces.js`,
 * `useWeatherDisplay.js`) pour le même découpage en familles.
 */
function skyFor(code) {
  if (code === 0) return { cloudCover: 0.05, cloudDensity: 0.3 };
  if (code === 1) return { cloudCover: 0.2, cloudDensity: 0.4 };
  if (code === 2) return { cloudCover: 0.5, cloudDensity: 0.5 };
  if (code === 3) return { cloudCover: 0.9, cloudDensity: 0.75 };
  if (code === 45 || code === 48) return { cloudCover: 0.6, cloudDensity: 0.5, haze: code === 48 ? 0.9 : 0.6 };
  if ([51, 53, 55, 56, 57].includes(code)) return { cloudCover: 0.75, cloudDensity: 0.6 };
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { cloudCover: 0.85, cloudDensity: 0.75 };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { cloudCover: 0.8, cloudDensity: 0.65 };
  if ([95, 96, 99].includes(code)) return { cloudCover: 0.95, cloudDensity: 0.9 };
  return null;
}

/**
 * Intensité de précipitation « de repli » par code, utilisée quand le moteur
 * n'a pas de mesure de pluie exploitable (mm/h manquant) — sinon un code 65
 * (« forte pluie ») sans mm/h renseigné rendrait un ciel sec.
 */
function fallbackPrecipitation(code) {
  if ([51, 56, 71, 77].includes(code)) return 0.25;
  if ([53, 61, 66, 73, 80, 85].includes(code)) return 0.5;
  if ([55, 63, 67, 75, 81, 82, 86].includes(code)) return 0.75;
  if ([95, 96, 99].includes(code)) return 0.9;
  return 0;
}

const SNOW_CODES = [71, 73, 75, 77, 85, 86];
const PRECIPITATION_CODES = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99];

/**
 * @param {Object|null} weather `participation.statistics.weather` (peut être
 *        absent tant que le moteur n'a pas encore chargé la météo).
 * @returns {Object|undefined} état partiel pour `world.updateSky({ weather })`,
 *          ou `undefined` si rien d'exploitable n'est disponible.
 */
export function sceneWeatherFor(weather) {
  const code = Number(weather?.weatherCode);
  if (!Number.isFinite(code)) return undefined;

  const sky = skyFor(code);
  if (!sky) return undefined;

  const rainMm = Number(weather?.rain);
  const precipitation = PRECIPITATION_CODES.includes(code)
    ? Number.isFinite(rainMm) && rainMm > 0
      ? Math.min(1, rainMm / 4)
      : fallbackPrecipitation(code)
    : 0;

  const windKmh = Number(weather?.windSpeed);
  const wind = Number.isFinite(windKmh) ? Math.min(1, Math.max(0, windKmh / WIND_FULL_KMH)) : undefined;

  return {
    cloudCover: sky.cloudCover,
    cloudDensity: sky.cloudDensity,
    precipitation,
    precipitationType: SNOW_CODES.includes(code) ? 'snow' : 'rain',
    haze: sky.haze,
    wind,
  };
}
