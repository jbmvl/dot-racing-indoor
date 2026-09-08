<template>
  <div class="ride-hud" :class="{ 'is-lifted': lifted }">
    <div class="ride-hud__row">
      <div class="ride-hud__stat ride-hud__stat--primary">
        <span class="ride-hud__value">{{ Math.round(powerW) }}</span>
        <span class="ride-hud__unit">watts</span>
      </div>
      <div class="ride-hud__stat">
        <span class="ride-hud__value">{{ speedKmh.toFixed(1) }}</span>
        <span class="ride-hud__unit">km/h</span>
      </div>
      <div class="ride-hud__stat">
        <span class="ride-hud__value">{{ wattsPerKg.toFixed(1) }}</span>
        <span class="ride-hud__unit">W/kg</span>
      </div>
      <div v-if="cadenceRpm > 0" class="ride-hud__stat">
        <span class="ride-hud__value">{{ Math.round(cadenceRpm) }}</span>
        <span class="ride-hud__unit">tr/min</span>
      </div>
      <div class="ride-hud__stat">
        <span class="ride-hud__value">{{ (distanceM / 1000).toFixed(2) }}</span>
        <span class="ride-hud__unit">km</span>
      </div>
      <div class="ride-hud__stat" :class="{ 'is-climb': gradePct > 0.5, 'is-descent': gradePct < -0.5 }">
        <span class="ride-hud__value">{{ gradePct.toFixed(1) }}</span>
        <span class="ride-hud__unit">%</span>
      </div>
      <div class="ride-hud__stat">
        <span class="ride-hud__value">{{ clock }}</span>
        <span class="ride-hud__unit">{{ $t('RIDE.TIME').toLowerCase() }}</span>
      </div>
    </div>
    <p v-if="keyboardDriven" class="ride-hud__hint">{{ $t('RIDE.KEYBOARD_HINT') }}</p>
  </div>
</template>

<script setup>
/*
 * RideHud — les quatre chiffres qu'on regarde en roulant.
 *
 * Volontairement muet : il n'a aucun accès à la séance, on lui passe des
 * nombres déjà publiés (cf. `useRide`). C'est ce qui permet de le rafraîchir
 * dix fois par seconde plutôt que soixante sans que personne ait à s'en
 * soucier.
 */
import { computed } from 'vue';

const props = defineProps({
  speedKmh: { type: Number, default: 0 },
  powerW: { type: Number, default: 0 },
  wattsPerKg: { type: Number, default: 0 },
  /** Zéro ou absent quand aucun capteur ne la donne : la case disparaît. */
  cadenceRpm: { type: Number, default: 0 },
  /** Masque l'indication clavier dès qu'un capteur pilote la puissance. */
  keyboardDriven: { type: Boolean, default: true },
  distanceM: { type: Number, default: 0 },
  gradePct: { type: Number, default: 0 },
  elapsedS: { type: Number, default: 0 },
  /** Remonte le bandeau au-dessus du profil altimétrique, quand il est affiché. */
  lifted: { type: Boolean, default: false },
});

const clock = computed(() => {
  const total = Math.max(0, Math.floor(props.elapsedS));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
});
</script>

<style scoped>
.ride-hud {
  position: absolute;
  left: 50%;
  bottom: max(1rem, env(safe-area-inset-bottom));
  transition: bottom 0.2s ease;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  pointer-events: none;
}

.ride-hud.is-lifted {
  bottom: calc(92px + max(0.75rem, env(safe-area-inset-bottom)));
}

.ride-hud__row {
  display: flex;
  gap: 0.25rem;
  padding: 0.5rem 0.75rem;
  border-radius: 14px;
  background: color-mix(in srgb, var(--c-bg) 82%, transparent);
  border: 1px solid var(--c-border);
  backdrop-filter: blur(10px);
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.18);
}

.ride-hud__stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 3.7rem;
  padding: 0 0.5rem;
  color: var(--c-text);
}

.ride-hud__stat + .ride-hud__stat {
  border-left: 1px solid var(--c-divider);
}

.ride-hud__stat--primary .ride-hud__value {
  font-size: 1.9rem;
}

.ride-hud__value {
  font-family: 'Fugaz One', 'Inter', sans-serif;
  letter-spacing: var(--fugaz-letter-spacing, -0.05em);
  font-size: 1.4rem;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.ride-hud__unit {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--c-text-muted);
}

.is-climb .ride-hud__value {
  color: #c0392b;
}

.is-descent .ride-hud__value {
  color: #2b8a5c;
}

.ride-hud__hint {
  margin: 0;
  font-size: 0.7rem;
  color: #fff;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
  opacity: 0.8;
}
</style>
