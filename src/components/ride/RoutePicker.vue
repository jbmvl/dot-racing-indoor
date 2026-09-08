<template>
  <div
    class="route-picker"
    :class="{ 'is-dragging': dragging }"
    @dragenter.prevent="dragging = true"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
  >
    <div class="route-picker__panel">
      <h1 class="route-picker__title">{{ $t('RIDE.TITLE') }}</h1>

      <p v-if="routes.length === 0" class="route-picker__empty">
        {{ $t('RIDE.NO_ROUTE_YET') }}
      </p>

      <ul v-else class="route-picker__list">
        <li v-for="route in routes" :key="route.id">
          <button type="button" class="route-picker__route" @click="$emit('choose', route)">
            <span class="route-picker__name">{{ route.name }}</span>
            <Tag v-if="route.imported">{{ $t('RIDE.IMPORTED') }}</Tag>
          </button>
          <button
            v-if="route.imported"
            type="button"
            class="route-picker__remove"
            :aria-label="$t('RIDE.REMOVE_ROUTE')"
            @click="$emit('remove', route.id)"
          >
            <IconTablerTrash />
          </button>
        </li>
      </ul>

      <div class="route-picker__trainer">
        <template v-if="trainer.supported">
          <ActionButton v-if="trainer.status.value !== 'connected'" @click="trainer.connect">
            {{ trainer.status.value === 'connecting' ? $t('TRAINER.CONNECTING') : $t('TRAINER.CONNECT') }}
          </ActionButton>
          <p v-else class="route-picker__trainer-ok">
            {{ $t('TRAINER.CONNECTED', { name: trainer.deviceName.value }) }}
          </p>
          <p v-if="trainer.status.value === 'error'" class="route-picker__error" role="alert">
            {{ trainer.errorMessage.value }}
          </p>
          <p v-else class="route-picker__hint">{{ $t('TRAINER.OPTIONAL') }}</p>
        </template>
        <p v-else class="route-picker__hint">{{ $t('TRAINER.UNSUPPORTED') }}</p>
      </div>

      <div class="route-picker__import">
        <!--
          Pas d'attribut `accept`.

          `accept=".gpx,application/gpx+xml"` grisait les fichiers dans le
          dialogue système : `application/gpx+xml` n'est un type MIME
          enregistré nulle part, et un navigateur qui ne sait pas rattacher une
          entrée d'`accept` à un type connu du système finit par ne plus rien
          proposer du tout. On ne peut donc pas sélectionner son propre
          parcours — le pire échec possible pour ce bouton.

          Le filtrage se fait après coup, sur le contenu : c'est de toute façon
          le seul juge fiable, un `.gpx` pouvant arriver renommé, sans extension
          ou en `.xml`.
        -->
        <input
          ref="fileInput"
          type="file"
          class="route-picker__file"
          @change="onPick"
        />
        <ActionButton @click="fileInput?.click()">{{ $t('RIDE.IMPORT_GPX') }}</ActionButton>
        <p class="route-picker__hint">{{ $t('RIDE.IMPORT_HINT') }}</p>
        <p v-if="importError" class="route-picker__error" role="alert">{{ importError }}</p>
        <p v-else-if="volatile" class="route-picker__warning">{{ $t('RIDE.IMPORT_VOLATILE') }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
/*
 * RoutePicker — choisir un parcours, ou en déposer un.
 *
 * Le dépôt de fichier n'est pas un confort : c'est ce qui permet d'utiliser
 * n'importe quel GPX — le sien, celui d'un club, celui d'une sortie — sans
 * attendre qu'il soit ajouté au dépôt de code. Glisser-déposer et sélecteur de
 * fichier mènent au même endroit ; les deux existent parce que le premier ne
 * marche pas au doigt sur mobile.
 */
import { ref } from 'vue';
import ActionButton from '@/components/ui/ActionButton.vue';
import Tag from '@/components/ui/Tag.vue';

const props = defineProps({
  routes: { type: Array, default: () => [] },
  volatile: { type: Boolean, default: false },
  /*
   * L'import est une **prop fonction**, et non un événement : il peut échouer
   * (fichier illisible, trace inexploitable) et c'est ici qu'il faut le dire.
   * Un `emit` ne rend rien, donc rien à attendre et rien à rattraper — le
   * message d'erreur ne serait jamais apparu.
   */
  onImport: { type: Function, required: true },
  /** Résultat de `useTrainer` — l'appairage se fait avant de rouler. */
  trainer: { type: Object, required: true },
});
defineEmits(['choose', 'remove']);

const fileInput = ref(null);
const dragging = ref(false);
const importError = ref('');

async function accept(file) {
  importError.value = '';
  try {
    await props.onImport(file);
  } catch (e) {
    importError.value = e?.message || 'fichier illisible';
  }
}

function onPick(event) {
  const file = event.target.files?.[0];
  // Le champ est remis à zéro : redéposer le même fichier doit redéclencher
  // l'événement, ce que le navigateur ne fait pas si la valeur n'a pas changé.
  event.target.value = '';
  if (file) accept(file);
}

function onDrop(event) {
  dragging.value = false;
  const file = event.dataTransfer?.files?.[0];
  if (file) accept(file);
}

/* Un survol d'enfant émet un `dragleave` sur le parent : on ne relâche donc le
 * cadre que lorsque le curseur quitte vraiment la zone. */
function onDragLeave(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) dragging.value = false;
}
</script>

<style scoped>
.route-picker {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: var(--c-bg);
  overflow-y: auto;
}

.route-picker.is-dragging {
  outline: 2px dashed var(--c-text-soft);
  outline-offset: -12px;
}

.route-picker__panel {
  width: 100%;
  max-width: 26rem;
}

.route-picker__title {
  margin: 0 0 1rem;
  font-family: 'Fugaz One', 'Inter', sans-serif;
  letter-spacing: var(--fugaz-letter-spacing, -0.05em);
  font-size: 1.5rem;
  color: var(--c-text);
}

.route-picker__list {
  list-style: none;
  margin: 0 0 1.25rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.route-picker__list li {
  display: flex;
  align-items: stretch;
  gap: 0.35rem;
}

.route-picker__route {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.7rem 0.85rem;
  border: 1px solid var(--c-border);
  border-radius: 10px;
  background: var(--c-bg-soft);
  color: var(--c-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.route-picker__route:hover {
  background: var(--c-bg-muted);
}

.route-picker__name {
  flex: 1;
}

.route-picker__remove {
  display: flex;
  align-items: center;
  padding: 0 0.6rem;
  border: 1px solid var(--c-border);
  border-radius: 10px;
  background: transparent;
  color: var(--c-text-muted);
  cursor: pointer;
}

.route-picker__remove:hover {
  color: var(--c-danger);
}

.route-picker__file {
  display: none;
}

.route-picker__empty {
  margin: 0 0 1.25rem;
  padding: 1.25rem 1rem;
  border: 1px dashed var(--c-border);
  border-radius: 10px;
  text-align: center;
  font-size: 0.85rem;
  color: var(--c-text-muted);
}

.route-picker__import,
.route-picker__trainer {
  padding-top: 1rem;
  border-top: 1px solid var(--c-divider);
}

.route-picker__trainer-ok {
  margin: 0;
  font-size: 0.85rem;
  color: var(--c-text);
}

.route-picker__hint {
  margin: 0.5rem 0 0;
  font-size: 0.78rem;
  color: var(--c-text-muted);
}

.route-picker__error {
  margin: 0.5rem 0 0;
  font-size: 0.8rem;
  color: var(--c-danger);
}

.route-picker__warning {
  margin: 0.5rem 0 0;
  font-size: 0.78rem;
  color: var(--c-text-soft);
}
</style>
