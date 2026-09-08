<template>
  <div class="stat-circle" v-if="visible" :class="{ 'only-value': !hasLabels }">
    <!-- render placeholders only when at least one label exists to preserve centering -->
    <div v-if="hasLabels" class="stat-small-label" :class="{ invisible: !smallLabel }" v-safe-html="smallLabel"></div>
    <div class="stat-value" :class="[fontClass, 'gradiented']" v-safe-html="valueHtml != null ? String(valueHtml) : valueText"></div>
    <div v-if="hasLabels" class="stat-label" :class="{ invisible: !label }">{{ label  }}</div>
  </div>
</template>

<script>
export default {
  name: 'StatCircle',
  props: {
    value: { type: [String, Number], default: '' },
    valueHtml: { type: [String, Number], default: null },
    smallLabel: { type: String, default: '' },
    label: { type: String, default: '' },
    visible: { type: Boolean, default: true }
  },
  computed: {
    hasLabels() {
      // when neither smallLabel nor label is provided we consider it "value only"
      return !!this.smallLabel || !!this.label;
    },
    valueText() {
      return String(this.value);
    },
    fontClass() {
      // mimic RacerBottomPanel.getFontSizeClass
      const raw = this.valueHtml != null && this.valueHtml !== '' ? String(this.valueHtml) : this.valueText;
      const str = raw.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      const length = str.length;
      if (length <= 2) return 'font-large';
      if (length === 3) return 'font-medium';
      if (length <= 4) return 'font-small';
      return 'font-xsmall';
    }
  }
};
</script>

<style scoped>
.stat-circle {
  width: 71px;
  height: 71px;
  border-radius: 50%;
  border: none;

  background: var(--glass-bg-darker);
  box-shadow: 0px 4px 14px rgba(0, 0, 0, 0.1);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);

  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
}

/* Gradient border via pseudo-element (same technique as ActionButton--primary) */
.stat-circle::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 2px;
  background: var(--glass-gradient);
  -webkit-mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  mask-composite: exclude;
  pointer-events: none;
}

.stat-small-label {
  font-family: 'Fugaz One', sans-serif; letter-spacing: var(--fugaz-letter-spacing, -0.02em); text-transform: uppercase;
  font-size: 11px;
  color: color-mix(in srgb, var(--c-icon) 58%, transparent);
  line-height: 0.9;
  padding: 3px;
  text-align: center;
  width: 50px;
}

.stat-small-label img { width: 20px; height: 14px; object-fit: contain; display: block; margin: 0 auto; }

.invisible { visibility: hidden; }

.stat-value {
  font-family: 'Fugaz One', sans-serif; letter-spacing: -0.08em; text-transform: uppercase;
  line-height: 0.5;
  color: color-mix(in srgb, var(--c-icon) 70%, transparent);
  transition: font-size 0.2s;
  white-space: nowrap;
}

/* background-clip: text nécessite que l'aire de fond couvre les glyphes.
   line-height: 0.5 est trop petit → on monte à 1 et on compense via margin négatif. */
.stat-value.gradiented {
  line-height: 1;
  margin: -0.25em 0;
  padding: 0 0.5em;
}

.stat-value.font-large { font-size: 37px; }
.stat-value.font-medium { font-size: 31px; }
.stat-value.font-small { font-size: 25px; }
.stat-value.font-xsmall { font-size: 21px; }

/* When only the value is shown (no smallLabel nor label), enlarge the value so it fills the circle */
.stat-circle.only-value .stat-value.font-large { font-size: 48px; }
.stat-circle.only-value .stat-value.font-medium { font-size: 41px; }
.stat-circle.only-value .stat-value.font-small { font-size: 31px; }
.stat-circle.only-value .stat-value.font-xsmall { font-size: 25px; }

.stat-value :deep(.ranking-suffix) {
  font-size: 0.5em;
  vertical-align: super;
  font-family: "Inter", sans-serif;
  text-transform: none;
  letter-spacing: normal;
}

.stat-label {
  font-family: 'Fugaz One', sans-serif; letter-spacing: var(--fugaz-letter-spacing, -0.02em); text-transform: uppercase;
  font-size: 13px;
  color: color-mix(in srgb, var(--c-icon) 81%, transparent);
}
</style>
