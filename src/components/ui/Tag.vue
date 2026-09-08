<template>
  <span class="ui-tag" role="note" :style="tagStyle">
    <slot>{{ text }}</slot>
  </span>
</template>

<script>
export default {
  name: 'UiTag',
  props: {
    text: { type: String, default: '' },
    // Couleur de fond optionnelle (sinon accent app). Permet de réutiliser le
    // composant partout avec de la couleur (badges, statuts, etc.).
    color: { type: String, default: null }
  },
  computed: {
    tagStyle() {
      return this.color ? { background: this.color } : {};
    }
  }
};
</script>

<style scoped>
.ui-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 12px;
  background: var(--c-icon);
  color: var(--c-bg);
  font-family: 'Fugaz One', sans-serif; letter-spacing: var(--fugaz-letter-spacing, -0.02em);
  text-transform: uppercase;
  font-size: 14px;
  line-height: 1;
  margin-left: 8px;
}
</style>
