<template>
  <div class="ride-view">
    <RoutePicker
      v-if="!started"
      :routes="library.routes.value"
      :volatile="library.lastImportVolatile.value"
      :on-import="handleImport"
      @choose="start"
      @remove="library.remove"
    />

    <template v-else>
      <RideScene
        :get-ride="ride.getRide"
        :on-frame="ride.frame"
        :active="ride.status.value === 'ready'"
        :paused="false"
      />

      <RideHud
        v-if="ride.status.value === 'ready'"
        :speed-kmh="ride.speedKmh.value"
        :distance-m="ride.distanceM.value"
        :grade-pct="ride.gradePct.value"
        :elapsed-s="ride.elapsedS.value"
      />

      <header v-if="ride.route.value" class="ride-view__header">
        <button type="button" class="ride-view__back" @click="stop">
          <IconTablerArrowLeft />
          <span>{{ $t('RIDE.CHANGE_ROUTE') }}</span>
        </button>
        <h1 class="ride-view__title">{{ ride.route.value.name }}</h1>
        <p v-if="ride.route.value.synthetic" class="ride-view__warning">
          {{ $t('RIDE.SYNTHETIC_ROUTE') }}
        </p>
      </header>

      <div v-if="ride.status.value === 'error'" class="ride-view__error" role="alert">
        <p>{{ $t('RIDE.ROUTE_ERROR') }}</p>
        <p class="ride-view__error-detail">{{ ride.errorMessage.value }}</p>
        <ActionButton @click="stop">{{ $t('RIDE.CHANGE_ROUTE') }}</ActionButton>
      </div>
    </template>
  </div>
</template>

<script setup>
/*
 * RideView — l'écran de séance, et le choix du parcours qui la précède.
 *
 * Orchestrateur et rien d'autre : il compose la bibliothèque de parcours, la
 * séance et la scène, sans rien décider. Toute logique qui apparaîtrait ici
 * appartient en réalité à un composable — c'est la règle que Dot Racing s'est
 * donnée pour `MapViewer`, et elle a bien vieilli.
 */
import { ref } from 'vue';
import RideScene from '@/components/ride/RideScene.vue';
import RideHud from '@/components/ride/RideHud.vue';
import RoutePicker from '@/components/ride/RoutePicker.vue';
import ActionButton from '@/components/ui/ActionButton.vue';
import { useRide } from '@/composables/ride/useRide.js';
import { useRouteLibrary } from '@/composables/ride/useRouteLibrary.js';

const library = useRouteLibrary();
const ride = useRide();
const started = ref(false);

function start(route) {
  started.value = true;
  ride.load(() => library.resolve(route.id));
}

/**
 * Retour au choix du parcours. `started` repasse à faux, ce qui démonte la
 * scène : le contexte WebGL est rendu au navigateur plutôt que gardé pour rien
 * — ils sont contingentés, et une séance suivante en redemandera un.
 */
function stop() {
  started.value = false;
}

/** Un parcours qu'on vient de déposer est celui qu'on veut essayer. */
async function handleImport(file) {
  const route = await library.importFile(file);
  start(route);
}
</script>

<style scoped>
.ride-view {
  position: fixed;
  inset: 0;
  overflow: hidden;
}

.ride-view__header {
  position: absolute;
  top: max(0.75rem, env(safe-area-inset-top));
  left: 0.9rem;
  right: 0.9rem;
}

.ride-view__back {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin-bottom: 0.35rem;
  padding: 0.3rem 0.6rem 0.3rem 0.4rem;
  border: none;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.35);
  color: #fff;
  font: inherit;
  font-size: 0.75rem;
  cursor: pointer;
  backdrop-filter: blur(6px);
}

.ride-view__back:hover {
  background: rgba(0, 0, 0, 0.5);
}

.ride-view__title {
  margin: 0;
  font-family: 'Fugaz One', 'Inter', sans-serif;
  letter-spacing: var(--fugaz-letter-spacing, -0.05em);
  font-size: 1.1rem;
  color: #fff;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.65);
  pointer-events: none;
}

.ride-view__warning {
  margin: 0.15rem 0 0;
  font-size: 0.72rem;
  color: #fff;
  opacity: 0.85;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
  pointer-events: none;
}

.ride-view__error {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 1.5rem;
  text-align: center;
  background: var(--c-bg);
  color: var(--c-danger);
}

.ride-view__error-detail {
  margin: 0;
  font-size: 0.8rem;
  color: var(--c-text-muted);
}
</style>
