<template>
  <div
    class="slider-wrapper"
    @click.stop
    @mousedown.stop
    @mouseup.stop
    @mousemove.stop
    @touchstart.stop
    @touchmove.stop
    @touchend.stop
    @pointerdown.stop
    @pointermove.stop
    @pointerup.stop
  >
    <div v-if="label || hasValueDisplay" class="slider-header">
      <span v-if="label" class="slider-label">{{ label }}</span>
      <slot v-if="$slots.value" name="value"></slot>
      <span v-else-if="formattedValue" class="slider-value">{{ formattedValue }}</span>
    </div>
    <div class="slider-track">
      <div v-if="showLowDisabledSegment" class="low-disabled-segment" :style="lowDisabledSegmentStyle" aria-hidden="true"></div>
      <div class="interactive-track" :style="interactiveStyle">
        <input 
          type="range" 
          :value="clampedValue"
          @input="onInput($event)"
          @click.stop
          @mousedown.stop
          @mouseup.stop
          @mousemove.stop
          @touchstart.stop
          @touchmove.stop
          @touchend.stop
          @pointerdown.stop
          @pointermove.stop
          @pointerup.stop
          :min="effectiveLowCap"
          :max="effectiveCap"
          :step="1"
          class="custom-slider"
          :aria-valuemin="min"
          :aria-valuemax="max"
          :aria-valuenow="clampedValue"
        />
      </div>
      <div v-if="showDisabledSegment" class="disabled-segment" :style="disabledSegmentStyle" aria-hidden="true"></div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'CustomSlider',
  props: {
    modelValue: {
      type: Number,
      default: 0
    },
    min: {
      type: Number,
      default: 0
    },
    max: {
      type: Number,
      default: 100
    },
    step: {
      type: Number,
      default: 1
    },
    label: {
      type: String,
      default: ''
    },
    formatter: {
      type: Function,
      default: null
    },
    // Hard cap value: user cannot set above this, but max scale still displayed.
    cap: {
      type: Number,
      default: null
    },
    // Hard low cap value: user cannot set below this, but min scale still displayed.
    lowCap: {
      type: Number,
      default: null
    }
  },
  emits: ['update:modelValue'],
  computed: {
    effectiveCap() {
      if (this.cap === null || typeof this.cap !== 'number') return this.max;
      return Math.min(this.cap, this.max);
    },
    effectiveLowCap() {
      if (this.lowCap === null || typeof this.lowCap !== 'number') return this.min;
      return Math.max(this.lowCap, this.min);
    },
    // Round lowCap up to next 15-minute mark (900 seconds)
    roundedLowCap() {
      const rawLowCap = this.effectiveLowCap;
      const stepSize = this.step; // typically 900 for 15 minutes
      if (rawLowCap <= this.min) return this.min;
      // Round up to next step
      return Math.ceil(rawLowCap / stepSize) * stepSize;
    },
    // Generate allowed values: only rounded steps (no exact lowCap)
    allowedValues() {
      const values = [];
      const rounded = this.roundedLowCap;
      const stepSize = this.step;
      
      // Only add step values from rounded to cap
      for (let v = rounded; v <= this.effectiveCap; v += stepSize) {
        values.push(v);
      }
      
      return values;
    },
    clampedValue() {
      const v = typeof this.modelValue === 'number' ? this.modelValue : this.min;
      if (v > this.effectiveCap) return this.effectiveCap;
      if (v < this.effectiveLowCap) return this.effectiveLowCap;
      return v;
    },
    formattedValue() {
      if (this.formatter) {
        return this.formatter(this.modelValue);
      }
      return null;
    },
    hasValueDisplay() {
      return !!this.$slots.value || !!this.formattedValue;
    },
    showDisabledSegment() {
      return this.effectiveCap < this.max;
    },
    showLowDisabledSegment() {
      return this.effectiveLowCap > this.min;
    },
    capPercent() {
      const span = this.max - this.min;
      if (span <= 0) return 0;
      return ((this.effectiveCap - this.min) / span) * 100;
    },
    lowCapPercent() {
      const span = this.max - this.min;
      if (span <= 0) return 0;
      return ((this.effectiveLowCap - this.min) / span) * 100;
    },
    interactiveStyle() {
      // Width and position of interactive part (between lowCap and cap)
      const leftPct = this.lowCapPercent;
      const rightPct = this.capPercent;
      const widthPct = rightPct - leftPct;
      return { 
        left: leftPct + '%',
        width: widthPct + '%', 
        minWidth: '40px' 
      };
    },
    disabledSegmentStyle() {
      return { left: this.capPercent + '%', width: (100 - this.capPercent) + '%' };
    },
    lowDisabledSegmentStyle() {
      return { left: '0%', width: this.lowCapPercent + '%' };
    }
  },
  watch: {
    cap(newVal, oldVal) {
      if (newVal === oldVal) return;
      // If current value is above new cap, emit clamped value
      if (typeof newVal === 'number' && this.modelValue > newVal) {
        this.$emit('update:modelValue', Math.min(newVal, this.max));
      }
    },
    lowCap(newVal, oldVal) {
      if (newVal === oldVal) return;
      // If current value is below new lowCap, emit clamped value
      if (typeof newVal === 'number' && this.modelValue < newVal) {
        this.$emit('update:modelValue', Math.max(newVal, this.min));
      }
    }
  },
  methods: {
    onInput(e) {
      let v = parseInt(e.target.value);
      if (isNaN(v)) v = this.roundedLowCap; // Use rounded, not raw
      if (v > this.effectiveCap) v = this.effectiveCap;
      if (v < this.effectiveLowCap) v = this.roundedLowCap; // Snap to rounded
      
      // Snap to nearest allowed value
      if (this.allowedValues.length > 0) {
        // Find closest allowed value
        let closest = this.allowedValues[0];
        let minDiff = Math.abs(v - closest);
        
        for (const allowed of this.allowedValues) {
          const diff = Math.abs(v - allowed);
          if (diff < minDiff) {
            minDiff = diff;
            closest = allowed;
          }
        }
        
        v = closest;
      }
      
      this.$emit('update:modelValue', v);
    }
  }
};
</script>

<style scoped>
.slider-wrapper {
  width: 100%;
  position: relative;
}
.slider-track { position: relative; width: 100%; }
.interactive-track { position: relative; }

.slider-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.slider-label {
  font-family: 'Fugaz One', sans-serif; letter-spacing: var(--fugaz-letter-spacing, -0.02em); text-transform: uppercase;
  font-size: 11px;
  color: var(--c-text-muted);
  text-transform: uppercase;
  letter-spacing: var(--fugaz-letter-spacing, -0.05em);
}

.slider-value {
  font-family: 'Fugaz One', sans-serif; letter-spacing: var(--fugaz-letter-spacing, -0.02em); text-transform: uppercase;
  font-size: 13px;
  color: var(--c-text);
}

.custom-slider {
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: var(--c-bg-muted);
  outline: none;
  -webkit-appearance: none;
  appearance: none;
}
.disabled-segment {
  position: absolute;
  top: 11px;
  transform: translateY(-50%);
  height: 6px;
  right: 0;
  background: color-mix(in srgb, var(--c-icon) 35%, transparent);
  pointer-events: none;
  border-radius: 0 3px 3px 0;
}

.low-disabled-segment {
  position: absolute;
  top: 13px;
  transform: translateY(-50%);
  height: 6px;
  left: 0;
  background: color-mix(in srgb, var(--c-icon) 35%, transparent);
  pointer-events: none;
  border-radius: 3px 0 0 3px;
}

.custom-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--c-icon);
  cursor: pointer;
  transition: transform 0.2s;
}

.custom-slider::-webkit-slider-thumb:hover {
  transform: scale(1.1);
}

.custom-slider::-moz-range-thumb {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--c-icon);
  cursor: pointer;
  border: none;
  transition: transform 0.2s;
}

.custom-slider::-moz-range-thumb:hover {
  transform: scale(1.1);
}
</style>
