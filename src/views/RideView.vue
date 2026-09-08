<template>
  <div class="ride-view">
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
      <h1 class="ride-view__title">{{ ride.route.value.name }}</h1>
      <p v-if="ride.route.value.synthetic" class="ride-view__warning">
        {{ $t('RIDE.SYNTHETIC_ROUTE') }}
      </p>
    </header>

    <div v-if="ride.status.value === 'error'" class="ride-view__error" role="alert">
      <p>{{ $t('RIDE.ROUTE_ERROR') }}</p>
      <p class="ride-view__error-detail">{{ ride.errorMessage.value }}</p>
      <ActionButton @click="ride.load()">{{ $t('COMMON.RETRY') }}</ActionButton>
    </div>
  </div>
</template>

<script setup>
/*
 * RideView — l'écran de séance.
 *
 * Orchestrateur et rien d'autre : il monte la scène, lui donne la séance à
 * faire avancer, et pose le tableau de bord par-dessus. Toute logique qui
 * apparaîtrait ici appartient en réalité à un composable — c'est la règle que
 * Dot Racing s'est donnée pour `MapViewer`, et elle a bien vieilli.
 */
import { onMounted } from 'vue';
import RideScene from '@/components/ride/RideScene.vue';
import RideHud from '@/components/ride/RideHud.vue';
import ActionButton from '@/components/ui/ActionButton.vue';
import { useRide } from '@/composables/ride/useRide.js';

const ride = useRide();

onMounted(() => ride.load());
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
  pointer-events: none;
}

.ride-view__title {
  margin: 0;
  font-family: 'Fugaz One', 'Inter', sans-serif;
  letter-spacing: var(--fugaz-letter-spacing, -0.05em);
  font-size: 1.1rem;
  color: #fff;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.65);
}

.ride-view__warning {
  margin: 0.15rem 0 0;
  font-size: 0.72rem;
  color: #fff;
  opacity: 0.85;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
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
