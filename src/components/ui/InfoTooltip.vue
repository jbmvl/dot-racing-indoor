<template>
  <teleport to="body">
    <FloatingMenu
      v-if="visible"
      :class="['info-tooltip', customClass]"
      :aria-label="ariaLabel"
      :style="constrainedMenuStyle"
    >
        <slot name="header"></slot>
        <slot name="body"></slot>
        <slot name="footer"></slot>
    </FloatingMenu>
  </teleport>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import FloatingMenu from './FloatingMenu.vue';
import { computeAnchoredTop, computeAnchoredLeft } from '@/lib/positionAnchor';

const props = defineProps({
  visible: { type: Boolean, default: false },
  ariaLabel: { type: String, default: 'Info tooltip' },
  customClass: { type: String, default: '' },
  // Anchor element ref (for anchor-based positioning)
  anchorElement: { type: Object, default: null },
  // Click event (InfoTooltip will extract coordinates automatically)
  clickEvent: { type: Object, default: null },
  // If true, closes when clicking outside
  closeOnClickOutside: { type: Boolean, default: true },
  // If true, closes on Escape key
  closeOnEscape: { type: Boolean, default: true }
});

const emit = defineEmits(['close']);

const menuStyle = ref({});
const constrainedMenuStyle = computed(() => ({
  maxWidth: 'min(400px, calc(100vw - 32px))',
  ...menuStyle.value
}));

// Internal coordinates extracted from clickEvent
const clickX = ref(null);
const clickY = ref(null);

// Watch for clickEvent changes and extract coordinates
watch(() => props.clickEvent, (event) => {
  if (event && typeof event.clientX === 'number' && typeof event.clientY === 'number') {
    clickX.value = Math.round(event.clientX);
    clickY.value = Math.round(event.clientY);
  } else {
    clickX.value = null;
    clickY.value = null;
  }
}, { immediate: true });

// Auto-detect positioning mode based on provided props
const effectivePositionMode = computed(() => {
  if (clickX.value != null && clickY.value != null) return 'click';
  if (props.anchorElement != null) return 'anchor';
  return 'center'; // fallback
});

const margin = 16;

// Position the tooltip
function positionTooltip() {
  if (!props.visible) return;

  try {
    // Wait for FloatingMenu to be rendered in DOM
    nextTick(() => {
      const menuEl = document.querySelector('.info-tooltip');
      if (!menuEl) return;

      const menuRect = menuEl.getBoundingClientRect();
      let left, top;

      const mode = effectivePositionMode.value;

      if (mode === 'click') {
        const clickRect = { top: clickY.value, bottom: clickY.value, left: clickX.value, right: clickX.value, width: 0, height: 0 };
        top = computeAnchoredTop(clickRect, menuRect.height, margin);
        left = computeAnchoredLeft(clickRect, menuRect.width, margin);
      } else if (mode === 'anchor') {
        const rect = props.anchorElement.getBoundingClientRect();
        top = computeAnchoredTop(rect, menuRect.height, margin);
        left = computeAnchoredLeft(rect, menuRect.width, margin);
      } else {
        // Fallback: center of screen
        left = Math.round(Math.max(margin, Math.min((window.innerWidth - menuRect.width) / 2, window.innerWidth - menuRect.width - margin)));
        top = Math.round(Math.max(margin, Math.min((window.innerHeight - menuRect.height) / 2, window.innerHeight - menuRect.height - margin)));
      }

      menuStyle.value = {
        position: 'fixed',
        left: `${left}px`,
        top: `${top}px`,
        zIndex: 90000,
        visibility: 'visible'
      };
    });
  } catch (e) {
    console.warn('[InfoTooltip] Failed to position tooltip:', e);
  }
}

// Handle click outside
function handleClickOutside(e) {
  if (!props.visible || !props.closeOnClickOutside) return;

  const menuEl = document.querySelector('.info-tooltip');
  const anchorEl = props.anchorElement;

  // Don't close if clicking on anchor or menu
  if (anchorEl && anchorEl.contains && anchorEl.contains(e.target)) return;
  if (menuEl && menuEl.contains(e.target)) return;

  emit('close');
}

// Handle escape key
function handleKeyDown(e) {
  if (e.key === 'Escape' && props.visible && props.closeOnEscape) {
    emit('close');
  }
}

// Watch visibility and reposition when shown
watch(() => props.visible, (newVal) => {
  if (newVal) {
    // Hide until positioned to prevent first-render flash
    menuStyle.value = { visibility: 'hidden', position: 'fixed', top: '0', left: '0', zIndex: 90000 };
    nextTick(() => {
      positionTooltip();
      // Attach listeners
      window.addEventListener('resize', positionTooltip);
      window.addEventListener('scroll', positionTooltip, true);
    });
  } else {
    menuStyle.value = {};
    // Remove listeners when hidden
    window.removeEventListener('resize', positionTooltip);
    window.removeEventListener('scroll', positionTooltip, true);
  }
}, { immediate: true });

// Reposition when internal click coordinates or anchor change
watch([clickX, clickY, () => props.anchorElement], () => {
  if (props.visible) {
    positionTooltip();
  }
});

onMounted(() => {
  window.addEventListener('click', handleClickOutside);
  window.addEventListener('keydown', handleKeyDown);
});

onBeforeUnmount(() => {
  window.removeEventListener('click', handleClickOutside);
  window.removeEventListener('keydown', handleKeyDown);
  window.removeEventListener('resize', positionTooltip);
  window.removeEventListener('scroll', positionTooltip, true);
});
</script>

<style scoped>
/* Base styling is provided by FloatingMenu */
/* Additional custom styles can be added via customClass prop */
</style>
