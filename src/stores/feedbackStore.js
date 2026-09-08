import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useFeedbackStore = defineStore('feedback', () => {
  const message = ref(null);
  const isVisible = ref(false);
  const isLoading = ref(false);
  let timeoutId = null;

  function showMessage(msg) {
    message.value = msg;
    isVisible.value = true;
    isLoading.value = false;

    if (timeoutId) clearTimeout(timeoutId);

    timeoutId = setTimeout(() => {
      isVisible.value = false;
      timeoutId = null;
    }, 5000);
  }

  /** Affiche un message persistant avec spinner (pas d'auto-hide). */
  function showPersistentMessage(msg) {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    message.value = msg;
    isVisible.value = true;
    isLoading.value = true;
  }

  /** Masque le message persistant (à appeler dans finally). */
  function hidePersistentMessage() {
    isVisible.value = false;
    isLoading.value = false;
  }

  function hideMessage() {
    isVisible.value = false;
    isLoading.value = false;
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  }

  return {
    message,
    isVisible,
    isLoading,
    showMessage,
    showPersistentMessage,
    hidePersistentMessage,
    hideMessage
  };
});
