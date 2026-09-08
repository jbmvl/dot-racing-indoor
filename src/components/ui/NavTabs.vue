<template>
  <div class="nav-tabs-root">
    <div
      ref="tabsContainerRef"
      v-bind="$attrs"
      :class="['nav-tabs', { 'nav-tabs--scrollable': scrollable, 'nav-tabs--small': small }]"
      :style="collapsedStyle"
    >
      <button
        v-for="tab in tabs"
        :key="tab.value"
        :data-value="tab.value"
        :class="['nav-tab', { active: modelValue === tab.value, 'nav-tab--small': small }]"
        @click="$emit('update:modelValue', tab.value)"
        type="button"
      >
        <span class="label">{{ tab.label }}</span>
        <span v-if="tab.count !== undefined && tab.count !== null" class="nav-badge">{{ tab.count }}</span>
      </button>
    </div>
    <button
      v-if="collapsible && overflowing"
      type="button"
      class="nav-tabs-toggle"
      @click="expanded = !expanded"
    >
      {{ expanded ? $t('COMMON.SHOW_LESS') : $t('COMMON.SHOW_MORE') }}
    </button>
  </div>
</template>

<script setup>
/*
  NavTabs.vue
  - `collapsible` (utilisable avec `small`) : replie la liste d'onglets à
    `collapsedLines` lignes avec un bouton « voir plus/moins ». Les onglets
    `small` sont en largeur naturelle avec retour à la ligne, donc leur
    nombre par ligne dépend de la largeur du conteneur — on mesure la
    hauteur réelle (ResizeObserver) plutôt que de la deviner en CSS pur.
    Même méthode que `isTitleStacked` dans AddBreakPopin.vue.
*/
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

defineOptions({ inheritAttrs: false });

const props = defineProps({
  modelValue: { type: String, required: true },
  tabs: { type: Array, required: true },
  // Quand les onglets dépassent la largeur : pas de wrap, défilement horizontal.
  scrollable: { type: Boolean, default: false },
  // Onglets compacts, largeur naturelle, retour à la ligne (ex. liste de
  // traversées sous un titre, plutôt qu'une barre de navigation pleine largeur).
  small: { type: Boolean, default: false },
  // Replie la liste à `collapsedLines` lignes avec un bouton « voir plus ».
  collapsible: { type: Boolean, default: false },
  collapsedLines: { type: Number, default: 2 }
});
defineEmits(['update:modelValue']);

const tabsContainerRef = ref(null);
const expanded = ref(false);
const overflowing = ref(false);
const maxHeight = ref(null);
let resizeObserver = null;

const collapsedStyle = computed(() => {
  if (!props.collapsible || expanded.value || !overflowing.value || !maxHeight.value) return {};
  return { maxHeight: `${maxHeight.value}px`, overflow: 'hidden' };
});

function updateLayout() {
  if (!props.collapsible) {
    overflowing.value = false;
    maxHeight.value = null;
    return;
  }

  const el = tabsContainerRef.value;
  const firstTab = el?.querySelector('.nav-tab');
  if (!el || !firstTab) {
    overflowing.value = false;
    maxHeight.value = null;
    return;
  }

  const rowHeight = firstTab.getBoundingClientRect().height;
  const rowGap = Number.parseFloat(window.getComputedStyle(el).rowGap) || 0;
  const lines = Math.max(1, props.collapsedLines);
  const linesHeight = (rowHeight * lines) + (rowGap * (lines - 1));

  maxHeight.value = linesHeight;
  overflowing.value = el.scrollHeight > (linesHeight + 1);
}

watch(() => props.tabs.length, () => {
  expanded.value = false;
  nextTick(() => updateLayout());
});

watch(() => props.collapsible, () => {
  nextTick(() => updateLayout());
});

onMounted(() => {
  resizeObserver = new ResizeObserver(() => {
    // `updateLayout` peut modifier la hauteur de l'élément observé (via
    // collapsedStyle) → différer d'une frame pour éviter la boucle
    // "ResizeObserver loop completed with undelivered notifications".
    requestAnimationFrame(() => updateLayout());
  });

  if (tabsContainerRef.value) resizeObserver.observe(tabsContainerRef.value);

  nextTick(() => updateLayout());
});

onBeforeUnmount(() => {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
});
</script>

<style scoped>
.nav-tabs {
  display: flex;
  gap: 8px;
  padding: 4px;
  padding-left: 24px;
  padding-right: 16px;

  margin-bottom: 16px;
  height: 40px;
}
.nav-tab {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 16px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--c-text);
  font-family: 'Fugaz One', sans-serif; letter-spacing: var(--fugaz-letter-spacing, -0.02em); text-transform: uppercase;
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
  border: 1px solid var(--c-text);

}
.nav-tab:hover:not(.active) {
  color: var(--c-text);
}
.nav-tab.active {
  background: var(--c-icon);
  color: var(--c-bg);
}
.nav-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--c-icon);
  color: var(--c-bg);
  font-size: 12px;
  margin-left: 8px;
}
.nav-tab.active .nav-badge {
  background: var(--c-bg);
  color: var(--c-icon);
}
.nav-tab .label { display: inline-block; }

/* Mode défilable : les onglets gardent leur largeur naturelle et la barre
   défile horizontalement quand ils dépassent. */
.nav-tabs--scrollable {
  flex-wrap: nowrap;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
}
.nav-tabs--scrollable .nav-tab {
  flex: 0 0 auto;
  white-space: nowrap;
}

/* Mode compact : largeur naturelle par onglet, retour à la ligne au lieu de
   défiler — pensé pour une liste courte insérée dans le corps d'une popin. */
.nav-tabs--small {
  flex-wrap: wrap;
  height: auto;
  padding-left: 0;
  padding-right: 0;
  gap: 6px;
  justify-content: center;
}
.nav-tab--small {
  flex: 0 0 auto;
  padding: 6px 14px;
  font-size: 12px;
}

.nav-tabs-toggle {
  display: block;
  width: 100%;
  margin-top: 4px;
  padding: 8px;
  border: none;
  background: none;
  color: var(--c-text-soft);
  font-size: 13px;
  font-weight: 600;
  text-decoration: underline;
  cursor: pointer;
}
</style>
