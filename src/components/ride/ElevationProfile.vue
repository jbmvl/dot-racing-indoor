<template>
  <div v-if="profile.hasElevation" class="elevation-profile">
    <div class="elevation-profile__stats">
      <span class="elevation-profile__stat">{{ Math.round(profile.lengthM / 1000 * 10) / 10 }} km</span>
      <span class="elevation-profile__stat">↑ {{ Math.round(profile.ascentM) }} m</span>
      <span class="elevation-profile__stat">↓ {{ Math.round(profile.descentM) }} m</span>
    </div>
    <div class="elevation-profile__chart">
      <canvas ref="canvasRef"></canvas>
    </div>
  </div>
</template>

<script setup>
/*
 * ElevationProfile — le parcours vu de profil, et où l'on en est dessus.
 *
 * Repris de `ElevationProfileBottomPanel.vue` de Dot Racing pour le traitement
 * visuel — axes muets, courbe remplie jusqu'aux bords, chiffres en Fugaz One —
 * mais la source de données est tout autre : là-bas, deux tracés (passé et
 * futur) reconstruits à chaque diffusion du serveur ; ici, **un parcours qui ne
 * change jamais**.
 *
 * C'est ce qui décide de l'architecture de ce fichier. Les données du graphique
 * sont construites **une fois**, au chargement du parcours. La position du
 * coureur, elle, bouge à chaque image — et elle est dessinée par un greffon
 * qui lit une variable ordinaire, jamais par une mise à jour des données. Un
 * `chart.data` réécrit dix fois par seconde relayouterait tout le graphique
 * pour déplacer un curseur de trois pixels.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, shallowRef } from 'vue';
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  Filler,
} from 'chart.js';
import { buildProfile } from '@/lib/route/elevationProfile.js';

Chart.register(LineController, LineElement, PointElement, LinearScale, Filler);

const props = defineProps({
  /** Le tracé. `null` tant qu'aucun parcours n'est chargé. */
  path: { type: Object, default: null },
  /** Abscisse courante **sur le tracé**, en mètres (bornée par le parcours). */
  routeDistanceM: { type: Number, default: 0 },
  /** Couleur du coureur, pour la portion déjà parcourue. */
  color: { type: String, default: '#3b82f6' },
});

const canvasRef = ref(null);
const chart = shallowRef(null);

const profile = computed(() => {
  if (!props.path) return { hasElevation: false, points: [], ascentM: 0, descentM: 0, lengthM: 0 };
  return buildProfile(props.path);
});

/*
 * Position lue par le greffon. Volontairement **hors de la réactivité** : elle
 * change soixante fois par seconde et n'a aucune raison de faire recalculer
 * quoi que ce soit — seulement de redessiner.
 */
let cursorKm = 0;
let lastDrawMs = 0;
/** Six rafraîchissements par seconde : au-delà, l'œil ne suit plus un curseur. */
const DRAW_INTERVAL_MS = 160;

function isDark() {
  if (typeof document === 'undefined') return false;
  const explicit = document.documentElement.getAttribute('data-theme');
  if (explicit) return explicit === 'dark';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

const axisColor = () => (isDark() ? 'rgba(240, 243, 248, 0.72)' : 'rgba(0, 0, 0, 0.62)');

/*
 * Le remplissage doit descendre jusqu'aux bords du canevas — un profil qui
 * flotte au milieu d'une marge ne ressemble à rien. On garde en revanche la
 * marge haute, où passent les chiffres d'altitude.
 */
const expandFillArea = {
  id: 'expandFillArea',
  afterLayout(instance) {
    const top = instance.chartArea.top;
    instance.chartArea.left = 0;
    instance.chartArea.right = instance.width;
    instance.chartArea.bottom = instance.height;
    instance.chartArea.top = top;
  },
};

/** La portion parcourue, et le curseur. Dessinés par-dessus la courbe. */
const riddenOverlay = {
  id: 'riddenOverlay',
  afterDatasetsDraw(instance) {
    const { ctx, chartArea, scales } = instance;
    const x = scales.x.getPixelForValue(cursorKm);
    if (!Number.isFinite(x)) return;

    ctx.save();

    /*
     * Le déjà-parcouru est un voile posé sur la bande de gauche, et non la
     * courbe repeinte d'une autre couleur.
     *
     * Repeindre serait plus joli, mais demanderait de redessiner le remplissage
     * sous la courbe — que Chart.js produit dans un greffon séparé (`Filler`),
     * à partir d'un chemin qu'il ne publie pas. On n'y accède qu'en tapant dans
     * ses internes, ce qui casse au premier changement de version mineure. Un
     * voile dit la même chose et ne dépend de rien.
     */
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = props.color;
    ctx.fillRect(chartArea.left, 0, Math.max(0, x - chartArea.left), instance.height);
    ctx.restore();

    // Le curseur.
    ctx.save();
    ctx.strokeStyle = props.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, instance.height);
    ctx.stroke();

    ctx.fillStyle = props.color;
    ctx.beginPath();
    ctx.arc(x, chartArea.top + 4, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  },
};

function build() {
  destroy();
  const canvas = canvasRef.value;
  if (!canvas || !profile.value.hasElevation) return;

  const color = axisColor();
  chart.value = new Chart(canvas, {
    type: 'line',
    data: {
      datasets: [
        {
          data: profile.value.points,
          parsing: false,
          borderColor: props.color,
          borderWidth: 1.5,
          backgroundColor: 'rgba(156, 163, 175, 0.22)',
          fill: 'start',
          pointRadius: 0,
          tension: 0.15,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      // Le graphique ne réagit pas au pointeur : il informe, il ne se pilote
      // pas. Le survol viendra si un besoin réel apparaît.
      events: [],
      layout: { padding: 0 },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: {
          type: 'linear',
          min: 0,
          max: profile.value.lengthM / 1000,
          grid: { display: false, drawTicks: false },
          border: { display: false },
          ticks: {
            color,
            font: { size: 10, family: 'Fugaz One, sans-serif' },
            crossAlign: 'far',
            padding: 0,
            maxTicksLimit: 4,
            // Un axe discret : seulement les deux bouts.
            callback: (value, index, ticks) =>
              index === 0 || index === ticks.length - 1 ? `${Math.round(Number(value))} km` : '',
          },
          afterFit: (scale) => {
            scale.height = 0;
          },
        },
        y: {
          bounds: 'data',
          grid: { display: false, drawTicks: false, drawOnChartArea: false },
          border: { display: false },
          ticks: {
            color,
            font: { size: 10, family: 'Fugaz One, sans-serif' },
            mirror: true,
            maxTicksLimit: 3,
            padding: 0,
            callback: (value) => `${Math.round(Number(value))} m`,
          },
          afterDataLimits: (scale) => {
            /*
             * Poser le point bas à 10 px du bas du canevas et le point haut à
             * 40 px du haut — la bande du haut est celle où passent les
             * étiquettes d'altitude. Repris tel quel de Dot Racing : sans cela,
             * un parcours plat occupe un trait au milieu du cadre, et un
             * parcours de montagne colle aux bords.
             */
            const BOTTOM_PX = 10;
            const TOP_PX = 40;
            const height = scale.chart.height;
            const usable = height - BOTTOM_PX - TOP_PX;
            if (!(usable > 0)) return;
            const span = scale.max - scale.min;
            if (!(span > 0)) return;
            const perPixel = span / usable;
            scale.min -= BOTTOM_PX * perPixel;
            scale.max += TOP_PX * perPixel;
          },
        },
      },
    },
    plugins: [expandFillArea, riddenOverlay],
  });
}

function destroy() {
  chart.value?.destroy();
  chart.value = null;
}

/*
 * Le thème peut changer sans que la page se recharge (bascule manuelle, ou
 * réglage système). Les couleurs d'axes sont dans les options du graphique,
 * pas dans le CSS : il faut donc les repousser à la main.
 */
let themeObserver = null;
let colorSchemeQuery = null;

function applyTheme() {
  if (!chart.value) return;
  const color = axisColor();
  chart.value.options.scales.x.ticks.color = color;
  chart.value.options.scales.y.ticks.color = color;
  chart.value.update('none');
}

onMounted(() => {
  build();
  themeObserver = new MutationObserver(applyTheme);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  colorSchemeQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
  colorSchemeQuery?.addEventListener?.('change', applyTheme);
});

onBeforeUnmount(() => {
  themeObserver?.disconnect();
  colorSchemeQuery?.removeEventListener?.('change', applyTheme);
  destroy();
});

// Un parcours ne change pas en roulant ; il change quand on en choisit un autre.
watch(() => props.path, build);

watch(
  () => props.routeDistanceM,
  (metres) => {
    cursorKm = metres / 1000;
    const now = performance.now();
    if (!chart.value || now - lastDrawMs < DRAW_INTERVAL_MS) return;
    lastDrawMs = now;
    // Les données n'ont pas bougé : seul le greffon a quelque chose de neuf à
    // dire. `'none'` évite l'animation, et il n'y a rien à recalculer.
    chart.value.update('none');
  }
);
</script>

<style scoped>
.elevation-profile {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 92px;
  background: color-mix(in srgb, var(--c-bg) 78%, transparent);
  border-top: 1px solid var(--c-border);
  backdrop-filter: blur(10px);
  pointer-events: none;
}

.elevation-profile__stats {
  position: absolute;
  top: 4px;
  right: 10px;
  z-index: 1;
  display: flex;
  gap: 0.6rem;
  font-family: 'Fugaz One', 'Inter', sans-serif;
  letter-spacing: var(--fugaz-letter-spacing, -0.05em);
  font-size: 0.72rem;
  color: var(--c-text-soft);
}

.elevation-profile__chart {
  position: absolute;
  inset: 0;
}
</style>
