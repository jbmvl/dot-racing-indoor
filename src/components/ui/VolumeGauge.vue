<template>
  <div class="volume-gauge">
    <div class="meter">
      <div class="fill" :style="{ width: pct + '%' }"></div>
    </div>
    <div class="labels">
      <!-- <div class="left">{{ formattedCurrent }} / {{ formattedMax }}</div> -->
      <div class="right" v-if="hint">{{ hint }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
const props = defineProps({
  current: { type: Number, default: 0 }, // litres
  max: { type: Number, required: true }, // litres
  hint: { type: String, default: '' }
});

const pct = computed(() => {
  if (!props.max || props.max <= 0) return 0;
  const p = Math.min(100, Math.round((props.current / props.max) * 10000) / 100);
  return p;
});

const formattedCurrent = computed(() => `${props.current.toFixed(2)} L`);
const formattedMax = computed(() => `${props.max.toFixed(2)} L`);

const fillColor = computed(() => {
  if (pct.value < 70) return '#4caf50';
  if (pct.value < 90) return '#ffa726';
  return '#f44336';
});
</script>

<style scoped>
.volume-gauge { width: 100%; padding: 8px 0 0 0; }
.meter { height: 12px; border-radius: 8px; border: 1px solid var(--c-border); overflow: hidden; }
.fill { height: 100%; width: 0%; transition: width 260ms ease; background: var(--c-icon); }
.labels { display:flex; justify-content:space-between; font-size:12px; color: var(--c-text-soft); margin-top:6px }
.left { font-weight:600 }
.right { color: var(--c-text-muted) }
</style>
