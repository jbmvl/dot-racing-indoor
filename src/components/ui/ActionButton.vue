<template>
  <!-- If an href is provided, render an anchor so external navigation works (OAuth flows, etc.) -->
  <a
    v-if="href"
    :href="href"
    :target="target"
    rel="noopener noreferrer"
    class="action-button"
    :class="[
      variant ? `action-button--${variant}` : '',
      groupPosition ? `action-button--group-${groupPosition}` : '',
      size ? `action-button--${size}` : ''
    ]"
    :aria-disabled="disabled ? 'true' : 'false'"
    @click="onClick"
  >
    <slot></slot>
  </a>

  <!-- Otherwise render a normal button -->
  <button
    v-else
    class="action-button"
    :class="[
      variant ? `action-button--${variant}` : '',
      groupPosition ? `action-button--group-${groupPosition}` : '',
      size ? `action-button--${size}` : ''
    ]"
    :disabled="disabled"
    @click="$emit('click')"
  >
    <slot></slot>
  </button>
</template>

<script>
export default {
  name: 'ActionButton',
  props: {
    variant: {
      type: String,
      default: 'default',
      validator: (value) => ['default', 'primary', 'secondary', 'white'].includes(value)
    },
    disabled: { type: Boolean, default: false },
    // Optional href to render an anchor instead of a button
    href: { type: String, default: null },
    // Anchor target (default to _self so OAuth endpoint in same tab)
    target: { type: String, default: '_self' },
    // Group position for button groups (left, middle, right)
    groupPosition: {
      type: String,
      default: null,
      validator: (value) => !value || ['left', 'middle', 'right'].includes(value)
    },
    size: {
      type: String,
      default: null,
      validator: (value) => !value || ['small'].includes(value)
    }
  },
  emits: ['click'],
  methods: {
    onClick(event) {
      // If disabled, prevent navigation and don't emit click
      if (this.disabled) {
        event.preventDefault();
        return;
      }
      this.$emit('click', event);
      // For anchors, let the browser handle navigation after emission
    }
  }
};
</script>

<style scoped>
.action-button {
  position: relative;
  padding: 8px 18px;
  border-radius: 50px;
  font-family: 'Fugaz One', sans-serif;
  font-size: 16px;
  text-transform: uppercase;
  letter-spacing: var(--fugaz-letter-spacing, -0.05em);
  cursor: pointer;
  border: none;
  transition: all 0.2s;
  flex: none;
  white-space: nowrap;

  /* Default: solid dark */
  background: none;
  color: var(--c-icon);
  border: solid 2px var(--c-icon);
}

.action-button--small {
  padding: 6px 14px;
  font-size: 13px;
}

/* Primary variant — gradient text + gradient border */
.action-button--primary {
  background: var(--glass-gradient-no-yellow);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
  border: none;
}

/* Gradient border for primary via pseudo-element */
.action-button--primary::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 3px;
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

.action-button--primary{ padding: 10px 20px; } /* Adjust padding to accommodate the 3px pseudo-element border */

/* Secondary variant */
.action-button--secondary {
  color: var(--c-text);
  border: solid 1px var(--c-icon);
}

/* White variant */
.action-button--white {
  color: #fff;
  border: solid 1px #fff;
  background: rgba(255, 255, 255, 0.08);
}

.action-button:active {
  transform: scale(0.98);
}

.action-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Button group styles - buttons that are grouped together */
.action-button--group-left {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
  border-right-width: 1px;
}

.action-button--group-middle {
  border-radius: 0;
  border-right-width: 1px;
  border-left-width: 1px;
}

.action-button--group-right {
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
  border-left-width: 1px;
}

/* Button group styles - buttons that are grouped together */
.action-button--secondary.action-button--group-left {

  border-right-width: .5px;
}

.action-button--secondary.action-button--group-middle {
  border-right-width: .5px;
  border-left-width: .5px;
}

.action-button--secondary.action-button--group-right {

  border-left-width: .5px;
}

a {
  text-decoration: none;
}
</style>
