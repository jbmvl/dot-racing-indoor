<template>
  <Transition name="feedback-slide">
    <div v-if="isVisible" class="feedback-container">
      <FloatingMenu class="feedback-menu" @click="!isLoading && hideMessage()">
        <Spinner v-if="isLoading" class="feedback-spinner" />
        <span class="feedback-text">{{ message }}</span>
        <button v-if="!isLoading" class="close-btn" @click.stop="hideMessage" aria-label="Fermer">
          <IconTablerX class="close-icon" />
        </button>
      </FloatingMenu>
    </div>
  </Transition>
</template>

<script setup>
import { storeToRefs } from 'pinia';
import { useFeedbackStore } from '@/stores/feedbackStore';
import FloatingMenu from './FloatingMenu.vue';
import Spinner from './Spinner.vue';

const store = useFeedbackStore();
const { message, isVisible, isLoading } = storeToRefs(store);
const { hideMessage } = store;

</script>

<style scoped>
.feedback-container {
  position: fixed;
  bottom: calc(var(--bottom-layout-height, 100px) + 20px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 200000;
  display: flex;
  justify-content: center;
  pointer-events: none;
  width: auto;
}

.feedback-menu {
  pointer-events: auto;
  cursor: pointer;
  max-width: 90vw;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-right: 12px; /* Adjust padding for close button */
}

.feedback-spinner {
  flex-shrink: 0;
  margin-right: 8px;
  width: 18px;
  height: 18px;
}

.feedback-text {
  font-weight: 500;
  font-size: 14px;
  color: var(--c-text);
  margin-right: 8px;
}

.close-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  color: var(--c-text-soft);
  border-radius: 50%;
  transition: background-color 0.2s;
}

.close-btn:hover {
  background-color: rgba(0, 0, 0, 0.05);
  color: var(--c-text);
}

.close-icon {
  width: 18px;
  height: 18px;
}

</style>
