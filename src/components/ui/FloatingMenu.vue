<template>
  <div ref="menuEl" class="floating-menu" :class="variantClass">
    <slot />
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue';

const props = defineProps({
  variant: {
    type: String,
    default: 'normal',
    validator: (value) => ['normal', 'small', 'small-dark'].includes(value)
  }
});

const variantClass = computed(() => {
  if (props.variant === 'small') return 'floating-menu--small';
  if (props.variant === 'small-dark') return 'floating-menu--small floating-menu--dark';
  return '';
});

const menuEl = ref(null);

onMounted(() => {
  if (!menuEl.value) return;
  const el = menuEl.value;
  // Force animation restart: when this component is rapidly remounted (e.g. :key change),
  // the browser may skip the CSS animation on the new element if it's inserted in the same
  // paint frame as the old one. The reflow flush ensures the animation plays from scratch.
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
});
</script>

<style scoped>
/* Base floating menu styles (normal variant) */
.floating-menu {
  box-sizing: border-box;
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 12px 24px;
  margin-bottom: calc(var(--safe-area-inset-bottom, 0px) + 8px);
  gap: 13px;
  isolation: isolate;
  margin: 0 auto;
  width: auto;
  /* Ensure menu never exceeds viewport */
  max-width: calc(100vw - 32px);
  background: var(--glass-bg);
  background-blend-mode: var(--glass-bg-blend);
  box-shadow: 0px 4px 14px rgba(0, 0, 0, 0.25), inset 0 0 14px rgba(255, 255, 255, .8);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  border-radius: 50px;
  border: 2px solid rgba(255, 255, 255, 0.6);
  animation: slideUpBounce 0.6s cubic-bezier(0.34, 1.35, 0.64, 1);
  animation-fill-mode: backwards;
  flex: none;
  order: 0;
  flex-grow: 0;
  z-index: 20000;
  /* Handle content overflow gracefully */
  overflow: hidden;
}

/* Improve active state: transitions, support focus, ARIA/data attribute and touch devices */
.floating-menu {
  transition: transform 160ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 160ms;
  transform-origin: center center;
  will-change: transform;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}

/* Pressed / active variants for mouse, keyboard, touch and programmatic toggles */
.floating-menu:active,
.floating-menu:focus-visible,
.floating-menu[data-pressed="true"],
.floating-menu[aria-pressed="true"] {
  transform: translateZ(0) scale(0.95);
}

/* Ensure touch-only devices also get immediate feedback */
@media (hover: none) and (pointer: coarse) {
  .floating-menu {
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
  }
  .floating-menu:active {
    transform: translateZ(0) scale(0.95);
  }
}

/* Small variant for timing labels */
.floating-menu--small {
  margin: 0;
  white-space: nowrap;
  font-family: 'Fugaz One', sans-serif; letter-spacing: var(--fugaz-letter-spacing, -0.02em);
  text-transform: uppercase;
  font-size: 12px;
  min-height: auto;
  padding: 4px 8px;
  pointer-events: none;
  animation: none;
}

/* Dark variant for small labels (hourly, gauge-depletion) */
.floating-menu--dark {
  background: rgba(0, 0, 0, 0.9) !important;
  color: #fff !important;
  border: 2px solid !important;
  box-shadow: 0px 4px 14px rgba(0, 0, 0, 0.25);
}

.floating-menu--dark :deep(.w-4) {
  color: #fff !important;
}

@keyframes slideUpBounce {
  0% {
    opacity: 0;
    filter: blur(10px);
    transform: translateZ(0) translateY(30px);
  }
  60% {
    opacity: 1;
    filter: blur(0);
    transform: translateZ(0) translateY(-2px);
  }
  80% {
    transform: translateZ(0) translateY(1px);
  }
  100% {
    opacity: 1;
    filter: blur(0);
    transform: translateZ(0) translateY(0);
  }
}
</style>
