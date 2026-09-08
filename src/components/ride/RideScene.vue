<template>
  <div class="ride-scene">
    <canvas ref="canvasRef" class="ride-scene__canvas"></canvas>

    <div v-if="state === 'loading'" class="ride-scene__status" role="status">
      <Spinner />
      <span>{{ $t('RIDE.SCENE_LOADING') }}</span>
    </div>

    <div v-else-if="state === 'error'" class="ride-scene__status ride-scene__status--error" role="alert">
      <span>{{ $t('RIDE.SCENE_ERROR') }}</span>
      <small v-if="errorMessage">{{ errorMessage }}</small>
    </div>

    <p v-if="state === 'ready' && attribution" class="ride-scene__credit">{{ attribution }}</p>
  </div>
</template>

<script setup>
/*
 * RideScene — la surface de rendu et ses états, rien de plus.
 *
 * Toute la mécanique (terrain, ciel, caméra, cycle de vie WebGL) vit dans
 * `useRideScene`. Ce découpage vient de Dot Racing et vaut d'être gardé : un
 * composant qui ne contient qu'un canevas et trois états se relit d'un coup
 * d'œil, et le jour où la scène change de moteur, ce fichier ne bouge pas.
 */
import { ref, toRef } from 'vue';
import { useRideScene } from '@/composables/scene/useRideScene.js';
import Spinner from '@/components/ui/Spinner.vue';

const props = defineProps({
  /** Séance en cours — l'objet `rideState`, jamais rendu réactif. */
  getRide: { type: Function, required: true },
  /** Appelé au début de chaque image : c'est là que la séance avance. */
  onFrame: { type: Function, default: null },
  /** Puissance instantanée, en watts. Commande les jambes du coureur. */
  getPowerW: { type: Function, default: () => undefined },
  active: { type: Boolean, default: false },
  paused: { type: Boolean, default: false },
  riderColor: { type: String, default: undefined },
});

const canvasRef = ref(null);

const { state, errorMessage, attribution } = useRideScene({
  canvasRef,
  getRide: props.getRide,
  onFrame: props.onFrame,
  getPowerW: props.getPowerW,
  active: toRef(props, 'active'),
  paused: toRef(props, 'paused'),
  getRiderColor: () => props.riderColor,
});
</script>

<style scoped>
.ride-scene {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: var(--c-bg-muted);
}

.ride-scene__canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.ride-scene__status {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  color: var(--c-text-soft);
  background: var(--c-bg);
  text-align: center;
  padding: 1.5rem;
}

.ride-scene__status--error {
  color: var(--c-danger);
}

.ride-scene__status small {
  color: var(--c-text-muted);
  font-size: 0.8rem;
}

.ride-scene__credit {
  position: absolute;
  right: 0.5rem;
  bottom: 0.35rem;
  margin: 0;
  font-size: 0.65rem;
  line-height: 1.2;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
  opacity: 0.75;
  pointer-events: none;
}
</style>
