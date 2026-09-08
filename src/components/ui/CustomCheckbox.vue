<template>
  <label
    class="custom-checkbox-wrapper"
    :class="[
      { 'is-checked': modelValue, 'is-disabled': disabled },
      theme === 'light' ? 'theme-light' : 'theme-default'
    ]"
  >
    <div class="custom-checkbox">
      <input 
        type="checkbox" 
        :checked="modelValue"
        :disabled="disabled"
        @change="$emit('update:modelValue', $event.target.checked)"
        :class="['checkbox-input', { 'small': small }]"
      />
      <span class="checkbox-box">
        <svg v-if="modelValue" class="check-icon" viewBox="0 0 24 24">
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
        </svg>
      </span>
    </div>
    <span v-if="label" :class="['checkbox-label', { 'small': small }]">{{ label }}</span>
  </label>
</template>

<script>
export default {
  name: 'CustomCheckbox',
  props: {
    modelValue: {
      type: Boolean,
      default: false
    },
    label: {
      type: String,
      default: ''
    },
    small: {
      type: Boolean,
      default: false
    },
    disabled: {
      type: Boolean,
      default: false
    },
    theme: {
      type: String,
      default: 'default',
      validator: (value) => ['default', 'light'].includes(value)
    }
  },
  emits: ['update:modelValue']
};
</script>

<style scoped>
.custom-checkbox-wrapper {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.custom-checkbox-wrapper.is-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.custom-checkbox {
  position: relative;
  flex-shrink: 0;
}

.checkbox-input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.checkbox-box {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: 2px solid var(--c-icon);
  background-color: var(--c-bg);
  border-radius: 4px;
  transition: all 0.2s;
}

.checkbox-input:checked + .checkbox-box {
  background: var(--c-icon);
  border-color: var(--c-icon);
}

.checkbox-input.small + .checkbox-box {
  width: 13px;
  height: 13px;
  border-width: 1.5px;
}

.check-icon {
  width: 16px;
  height: 16px;
  fill: var(--c-bg);
}

.checkbox-input.small + .checkbox-box .check-icon {
  width: 12px;
  height: 12px;
}

.checkbox-label {
  font-size: 14px;
  color: var(--c-text);
  user-select: none;
}

.checkbox-label.small {
  font-size: 12px;
}

.custom-checkbox-wrapper.theme-light .checkbox-box {
  border-color: #fff;
}

.custom-checkbox-wrapper.theme-light .checkbox-input:checked + .checkbox-box {
  background: none;
  border-color: #fff;
}

.custom-checkbox-wrapper.theme-light .check-icon {
  fill: #fff;
}

.custom-checkbox-wrapper.theme-light .checkbox-label {
  color: #fff;
}
</style>
