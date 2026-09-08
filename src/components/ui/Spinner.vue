<template>
  <div 
    :class="['spinner', `spinner--${size}`, { 'spinner--centered': centered }]"
    :aria-label="label"
    role="status"
  >
    <IconTablerLoader2 class="spinner__icon" />
  </div>
</template>

<script setup>
/*
  Composant: Spinner
  -------------------
  Spinner de chargement réutilisable avec différentes tailles.
  
  Props:
  - size: 'xs' | 'sm' | 'md' | 'lg' | 'xl' (défaut: 'md')
  - centered: boolean - centre le spinner dans son conteneur
  - label: string - texte d'accessibilité (défaut: 'Chargement...')
  
  Usage:
    <Spinner size="sm" />
    <Spinner size="lg" centered label="Chargement des données..." />
*/
import IconTablerLoader2 from '~icons/tabler/loader-2';

defineProps({
  size: {
    type: String,
    default: 'md',
    validator: (value) => ['xs', 'sm', 'md', 'lg', 'xl'].includes(value)
  },
  centered: {
    type: Boolean,
    default: false
  },
  label: {
    type: String,
    default: 'Chargement...'
  }
});
</script>

<style scoped>
.spinner {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: color-mix(in srgb, var(--c-icon) 60%, transparent);
}

.spinner--centered {
  display: flex;
  width: 100%;
  height: 100%;
}

.spinner__icon {
  animation: spin 1s linear infinite;
  flex-shrink: 0;
}

/* Couleur blanche pour le spinner dans les boutons */
button .spinner {
  color: currentColor;
}

/* Tailles */
.spinner--xs .spinner__icon {
  width: 16px;
  height: 16px;
}

.spinner--sm .spinner__icon {
  width: 20px;
  height: 20px;
}

.spinner--md .spinner__icon {
  width: 28px;
  height: 28px;
}

.spinner--lg .spinner__icon {
  width: 36px;
  height: 36px;
}

.spinner--xl .spinner__icon {
  width: 48px;
  height: 48px;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
