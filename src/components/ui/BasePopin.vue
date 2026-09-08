<template>
  <transition name="popin" appear>
    <div
      v-if="isOpen"
      ref="popinEl"
      :class="[
        'popin-overlay', 
        `popin-overlay--${layout}`,
        { 'popin-overlay--drag-closing': modalDrag.isClosing }
      ]"
      role="dialog"
      aria-modal="true"
      @pointerdown.capture="onOverlayPointerDownCapture"
      @click.self="handleOverlayClick"
    >
      <div 
        ref="contentEl"
        :class="[
          'popin-content', 
          `popin-content--${layout}`,
          { 'popin-content--drag-closing': modalDrag.isClosing }
        ]"
        :style="contentStyle"
      >
        <button
          v-if="closable"
          class="popin-close"
          type="button"
          aria-label="Close"
          title="Fermer"
          @click.stop="close"
        >
          ✕
        </button>
        <slot></slot>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick, computed } from 'vue'
import { useBottomSheet } from '@/composables/ui/useBottomSheet'

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false
  },
  // Layout mode: 
  // - 'modal' (default): centered overlay with backdrop
  // - 'sidebar': right sidebar on desktop, bottom sheet on mobile (Google Maps style)
  layout: {
    type: String,
    default: 'modal',
    validator: (value) => ['modal', 'sidebar'].includes(value)
  },
  // Options pour le bottom sheet mobile (layout sidebar uniquement)
  bottomSheetOptions: {
    type: Object,
    default: () => ({})
  },
  // Afficher ou non le bouton de fermeture (croix)
  closable: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['close', 'bottomSheetReady'])

const isClosing = ref(false)
const popinEl = ref(null)
const contentEl = ref(null)
const resizeAnimationStyle = ref({})
const overlayPointerDownOnBackdrop = ref(false)

let resizeObserver = null
let resizeAnimationFrame = null
let resizeCleanupTimer = null
let lastMeasuredSize = null
let isAnimatingResize = false
// Fenêtre de "settle" juste après l'ouverture : la toute première mesure peut être prise
// avant que les web fonts (Fugaz One, chargée en @import async) aient fini leur swap, ce
// qui décale légèrement les métriques de texte. Sans cette garde, le ResizeObserver capte
// cette mesure prématurée comme baseline, puis anime un "correctif" visible (la popin
// semble s'ouvrir en trop grand puis se réduire) dès la mesure suivante, correcte.
let resizeSettleUntil = 0
const RESIZE_SETTLE_MS = 400

// Bottom sheet composable (only for sidebar layout on mobile)
const isMobile = computed(() => {
  if (typeof window === 'undefined') return false
  return window.innerWidth <= 768
})

const shouldUseBottomSheet = computed(() => {
  return props.layout === 'sidebar' && isMobile.value
})

// Drag-to-close for modal popins on mobile
const shouldUseDragToClose = computed(() => {
  return props.layout === 'modal' && isMobile.value
})

// Modal drag state
const modalDrag = ref({
  isDragging: false,
  startY: 0,
  currentY: 0,
  translateY: 0,
  scrollTop: 0,
  isClosing: false // Flag pour garder le translateY pendant la fermeture
})

const modalDragStyle = computed(() => {
  if (!shouldUseDragToClose.value) return {}
  
  // Pendant le drag : suivre le doigt sans transition
  if (modalDrag.value.isDragging) {
    return {
      transform: `translateY(${modalDrag.value.translateY}px)`,
      transition: 'none'
    }
  }
  
  // Pendant la fermeture : animer vers le bas
  if (modalDrag.value.isClosing) {
    return {
      transform: `translateY(${modalDrag.value.translateY}px)`,
      transition: 'transform 0.2s ease-out'
    }
  }
  
  return {}
})

const shouldAnimateResize = computed(() => {
  return (
    props.isOpen &&
    !shouldUseBottomSheet.value &&
    !isClosing.value &&
    !modalDrag.value.isDragging &&
    !modalDrag.value.isClosing
  )
})

const bottomSheet = useBottomSheet({
  isOpen: computed(() => props.isOpen),
  onClose: close,
  ...props.bottomSheetOptions
})

// Expose bottomSheet via emit for parent components
watch(() => shouldUseBottomSheet.value, (isBottomSheet) => {
  if (isBottomSheet) {
    nextTick(() => {
      emit('bottomSheetReady', bottomSheet)
    })
  }
}, { immediate: true })

// Style binding for mobile bottom sheet
const contentStyle = computed(() => {
  let baseStyle = {}

  // Drag-to-close style for modal popins (prioritaire)
  if (shouldUseDragToClose.value && (modalDrag.value.isDragging || modalDrag.value.isClosing)) {
    baseStyle = modalDragStyle.value
  }

  // Bottom sheet style for sidebar layout
  if (shouldUseBottomSheet.value && props.isOpen) {
    // Pas de transition pendant le drag, mais oui pendant l'animation d'ouverture ou les snaps
    const shouldTransition = !bottomSheet.isDragging.value

    baseStyle = {
      ...baseStyle,
      transform: `translateY(${bottomSheet.currentTranslate.value}px)`,
      height: `${bottomSheet.maxHeight.value}px`,
      transition: shouldTransition 
        ? 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), height 0.3s cubic-bezier(0.4, 0, 0.2, 1)' 
        : 'none',
      overflowY: bottomSheet.shouldDisableScroll.value ? 'hidden' : 'auto'
    }
  }

  return {
    ...baseStyle,
    ...resizeAnimationStyle.value
  }
})

function getMeasuredSize(el) {
  if (!el) return null

  const { width, height } = el.getBoundingClientRect()
  return {
    width: Math.round(width),
    height: Math.round(height)
  }
}

function clearResizeAnimation() {
  if (resizeAnimationFrame) {
    cancelAnimationFrame(resizeAnimationFrame)
    resizeAnimationFrame = null
  }

  if (resizeCleanupTimer) {
    clearTimeout(resizeCleanupTimer)
    resizeCleanupTimer = null
  }

  resizeAnimationStyle.value = {}
  isAnimatingResize = false
}

function animateResize(fromSize, toSize) {
  if (!contentEl.value) return

  clearResizeAnimation()
  isAnimatingResize = true

  resizeAnimationStyle.value = {
    width: `${fromSize.width}px`,
    height: `${fromSize.height}px`,
    transition: 'none'
  }

  void contentEl.value.offsetHeight

  resizeAnimationFrame = requestAnimationFrame(() => {
    resizeAnimationStyle.value = {
      width: `${toSize.width}px`,
      height: `${toSize.height}px`,
      transition: 'width 0.18s ease, height 0.18s ease'
    }

    resizeCleanupTimer = window.setTimeout(() => {
      resizeAnimationStyle.value = {}
      isAnimatingResize = false
      lastMeasuredSize = getMeasuredSize(contentEl.value)
      resizeCleanupTimer = null
    }, 180)
  })
}

function syncResizeBaseline() {
  if (!contentEl.value) return
  clearResizeAnimation()
  lastMeasuredSize = getMeasuredSize(contentEl.value)
  resizeSettleUntil = Date.now() + RESIZE_SETTLE_MS
}

function setupResizeObserver() {
  if (typeof ResizeObserver === 'undefined' || resizeObserver || !contentEl.value) return

  resizeObserver = new ResizeObserver(() => {
    // La callback déclenche `animateResize`, qui modifie la taille de l'élément
    // OBSERVÉ (contentEl). Fait en synchrone dans la callback, cela provoque
    // l'avertissement navigateur « ResizeObserver loop completed with undelivered
    // notifications » (visible en overlay Vite). On diffère d'une frame : le cycle
    // d'observation courant se termine sans redimensionnement synchrone.
    requestAnimationFrame(() => {
      if (!contentEl.value) return
      const nextSize = getMeasuredSize(contentEl.value)
      if (!nextSize) return

      if (!lastMeasuredSize) {
        lastMeasuredSize = nextSize
        return
      }

      const widthChanged = Math.abs(nextSize.width - lastMeasuredSize.width) > 1
      const heightChanged = Math.abs(nextSize.height - lastMeasuredSize.height) > 1

      if (!widthChanged && !heightChanged) return

      // Pendant la fenêtre de "settle" juste après l'ouverture, on resynchronise
      // silencieusement au lieu d'animer : cette variation vient probablement du swap
      // des web fonts, pas d'un vrai changement de contenu (cf. resizeSettleUntil plus haut).
      if (!shouldAnimateResize.value || isAnimatingResize || Date.now() < resizeSettleUntil) {
        lastMeasuredSize = nextSize
        return
      }

      const previousSize = lastMeasuredSize
      lastMeasuredSize = nextSize
      animateResize(previousSize, nextSize)
    })
  })

  resizeObserver.observe(contentEl.value)
}

function cleanupResizeObserver() {
  clearResizeAnimation()
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  lastMeasuredSize = null
}

function close() {
  if (isClosing.value) return
  isClosing.value = true
  
  const delay = props.layout === 'sidebar' ? 150 : 100
  setTimeout(() => {
    emit('close')
    isClosing.value = false
  }, delay)
}

function onKeydown(e) {
  if (e.key === 'Escape' && props.isOpen) close()
}

function handleOverlayClick() {
  const shouldClose = props.layout === 'modal' && overlayPointerDownOnBackdrop.value
  overlayPointerDownOnBackdrop.value = false

  if (shouldClose) {
    close()
  }
}

function onOverlayPointerDownCapture(event) {
  overlayPointerDownOnBackdrop.value = event.target === event.currentTarget
}

// Modal drag-to-close handlers
function onModalTouchStart(e) {
  if (!shouldUseDragToClose.value) return
  
  const content = e.currentTarget
  const scrollTop = content.scrollTop || 0
  
  // Seulement démarrer le drag si on est en haut du scroll
  if (scrollTop > 5) return
  
  const touch = e.touches[0]
  modalDrag.value = {
    isDragging: false, // Pas encore, on attend un mouvement
    startY: touch.clientY,
    currentY: touch.clientY,
    translateY: 0,
    scrollTop
  }
}

function onModalTouchMove(e) {
  if (!shouldUseDragToClose.value) return
  if (!modalDrag.value.startY) return
  
  const touch = e.touches[0]
  const deltaY = touch.clientY - modalDrag.value.startY
  
  // Seulement drag vers le bas (deltaY positif)
  if (deltaY < 0) return
  
  // Commencer le drag si mouvement > 5px
  if (!modalDrag.value.isDragging && deltaY > 5) {
    modalDrag.value.isDragging = true
  }
  
  if (modalDrag.value.isDragging) {
    e.preventDefault()
    modalDrag.value.currentY = touch.clientY
    modalDrag.value.translateY = deltaY
  }
}

function onModalTouchEnd() {
  if (!shouldUseDragToClose.value) return
  if (!modalDrag.value.isDragging) {
    // Reset si pas de drag
    modalDrag.value = { isDragging: false, startY: 0, currentY: 0, translateY: 0, scrollTop: 0, isClosing: false }
    return
  }
  
  const deltaY = modalDrag.value.translateY
  
  // Si drag > 80px, fermer la popin
  if (deltaY > 80) {
    // Marquer comme "en fermeture" et augmenter le translateY pour sortir complètement de l'écran
    modalDrag.value.isDragging = false
    modalDrag.value.isClosing = true
    
    // Animer jusqu'à la hauteur de la fenêtre pour sortir complètement
    const viewportHeight = window.innerHeight
    modalDrag.value.translateY = viewportHeight
    
    close()
    
    // Reset après le délai de fermeture
    setTimeout(() => {
      modalDrag.value = { isDragging: false, startY: 0, currentY: 0, translateY: 0, scrollTop: 0, isClosing: false }
    }, 250) // Délai un peu plus long pour laisser l'animation se terminer
  } else {
    // Reset immédiat si pas de fermeture
    modalDrag.value = { isDragging: false, startY: 0, currentY: 0, translateY: 0, scrollTop: 0, isClosing: false }
  }
}

function setupContentEl() {
  const content = contentEl.value
  
  if (content && shouldUseBottomSheet.value) {
    bottomSheet.setupListeners(content)
  }
  
  // Attacher les listeners de drag-to-close pour modal mobile
  if (content && shouldUseDragToClose.value) {
    content.addEventListener('touchstart', onModalTouchStart, { passive: false })
    content.addEventListener('touchmove', onModalTouchMove, { passive: false })
    content.addEventListener('touchend', onModalTouchEnd)
  }
  
  // Reset scroll to top
  if (content) {
    content.scrollTop = 0
    syncResizeBaseline()
    setupResizeObserver()
  }
}

function cleanupModalDragListeners() {
  const content = contentEl.value
  
  if (content) {
    content.removeEventListener('touchstart', onModalTouchStart)
    content.removeEventListener('touchmove', onModalTouchMove)
    content.removeEventListener('touchend', onModalTouchEnd)
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  if (props.isOpen) {
    nextTick(setupContentEl)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  bottomSheet.cleanupListeners()
  cleanupModalDragListeners()
  cleanupResizeObserver()
})

watch(() => props.isOpen, (newVal) => {
  if (newVal) {
    overlayPointerDownOnBackdrop.value = false
    nextTick(setupContentEl)
  } else {
    overlayPointerDownOnBackdrop.value = false
    // Cleanup modal drag listeners when closing
    cleanupModalDragListeners()
    cleanupResizeObserver()
    // Reset modal drag state (un peu après pour laisser l'animation se terminer)
    setTimeout(() => {
      modalDrag.value = { isDragging: false, startY: 0, currentY: 0, translateY: 0, scrollTop: 0, isClosing: false }
    }, 200)
  }
})

watch([shouldUseBottomSheet, shouldAnimateResize], () => {
  if (!props.isOpen) return

  nextTick(() => {
    syncResizeBaseline()
    setupResizeObserver()
  })
})

// Watch for bottomSheetOptions changes (deep watch on the whole object)
watch(() => props.bottomSheetOptions, (newOptions) => {
  if (newOptions?.initialState && shouldUseBottomSheet.value && props.isOpen) {
    // Petit délai pour laisser le DOM se mettre à jour
    setTimeout(() => {
      bottomSheet.setState(newOptions.initialState)
    }, 50)
  }
}, { deep: true })

</script>

<style scoped>

h2 {
    font-size: 22px!important;
}
.popin-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  /* ensure popins render above floating menus which may use very large z-indexes */
  z-index: 30001;
  background: rgba(0, 0, 0, 0.1);
  backdrop-filter: blur(2px);

  /* provide edge insets on small screens */
  padding: 12px;
  /* account for notches on iOS */
  padding-top: calc(env(safe-area-inset-top, 0px) + 12px);
  padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 12px);
}


.popin-content {
  position: relative;
  display: flex;
  flex-direction: column;
  /* Start content at the top; avoid vertical centering which can cause mid-scroll */
  justify-content: flex-start;
  align-items: stretch;
  padding: 24px 32px;
  gap: 12px;
  box-sizing: border-box;
  
  /* Responsive sizing: fixed preferred width with a safe max on small screens */
  width: 450px;
  max-width: calc(100vw - 24px);
  /* Use dynamic viewport height to account for mobile browser UI */
  /* Utiliser 100dvh pour compatibilité iOS Safari et Android Chrome */
  max-height: calc(100dvh - 160px);
  
  background: var(--glass-bg);
  background-blend-mode: var(--glass-bg-blend);
  box-shadow: 0px 4px 10px 10px rgba(0, 0, 0, 0.1);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  border-radius: 50px;
  
  overflow: hidden;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;

    z-index: 30002;

}

/* Sidebar layout - desktop: left panel, mobile: bottom sheet */
.popin-overlay--sidebar {
  /* Desktop: no overlay, just sidebar positioning */
  position: absolute;
  display: block;
  padding: 0;
  backdrop-filter: none;
  background-color: transparent;
  width: auto;
  height: auto;
  /* Remove pointer events from overlay to allow map interaction */
  pointer-events: none;
}

.popin-content--sidebar {
  /* Desktop: left sidebar panel */
  position: fixed;
  left: 0;
  top: 0;
  max-width: 400px;
  width: 400px;
  /* Account for overlay padding to fit within viewport */
  max-height: 100vh;
  height: 100vh;
  border-radius: 0;
  box-shadow: 0px 4px 10px 10px rgba(0, 0, 0, 0.1);
  /* Re-enable pointer events on the sidebar itself */
  pointer-events: auto;
  /* Ensure sidebar is above map elements and floating menus */
  z-index: 30002;
  /* Use box-sizing to include padding in height calculation */
  box-sizing: border-box;

  backdrop-filter : blur(4px);
}

/* Sidebar enter animation (desktop only) - override modal animation */
.popin-enter-active .popin-content--sidebar {
  animation: slideInLeft 0.2s ease-out normal !important;
}

/* Sidebar leave animation (desktop only): play the same keyframes in reverse */
.popin-leave-active .popin-content--sidebar {
  animation: slideInLeft 0.2s ease-in reverse !important;
}

/* Mobile: bottom sheet with touch-controlled positioning */
@media (max-width: 768px) {
  /* Disable desktop sidebar animations on mobile */
  .popin-enter-active .popin-content--sidebar,
  .popin-leave-active .popin-content--sidebar {
    animation: none !important;
  }
  
  .popin-overlay--sidebar {
    /* Must use fixed instead of static to establish a stacking context
       and ensure z-index works during transitions */
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    /* Keep pointer-events: none to allow map interaction through transparent areas */
  }
  
  .popin-content--sidebar {
    border-radius: 40px 40px 0 0 !important;
    box-shadow: 0px 4px 10px 10px rgba(0, 0, 0, 0.1);
    padding-bottom: env(safe-area-inset-bottom);
    /* Positioning for bottom sheet */
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    width: 100vw!important;
    max-width: 100vw!important;

    max-height: calc(100dvh)!important;

    /* Height and transform are controlled dynamically via JS */
    /* transform and transition are applied via :style binding */
    /* Enable touch scrolling */
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
    /* Re-enable pointer events */
    pointer-events: auto;
    /* Use box-sizing to include padding in height calculation */
    box-sizing: border-box;
    
  }
  
  /* Add drag handle indicator for mobile */
  .popin-content--sidebar::before {
    content: '';
    display: block;
    width: 40px;
    height: 5px;
    background: var(--c-bg-muted);
    border-radius: 3px;
    margin: 4px auto 8px;
    flex-shrink: 0;
    /* Make it clear it's draggable */
    cursor: grab;
    touch-action: none;
    position: absolute;
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
  }
  
  /* Visual feedback when touching the handle */
  .popin-content--sidebar:active::before {
    background: var(--c-border);
    cursor: grabbing;
  }
}

.popin-close {
  position: absolute;
  top: 18px;
  right: 18px;
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  line-height: 1;
  color: var(--c-icon);
  z-index: 30002; /* ensure above inner content */
}


/* Animation d'entrée/sortie */

/* Modal (non-sidebar) enter/leave: apply animation to the inner content
   when the overlay receives the transition classes. Use descendant selector
   so the animation targets `.popin-content`. */
.popin-enter-active:not(.popin-overlay--sidebar) .popin-content {
  animation: popinSlideUp 0.3s cubic-bezier(0.34, 1.35, 0.64, 1) 0s 1 normal;
}

.popin-leave-active:not(.popin-overlay--sidebar) .popin-content {
  animation: popinSlideUp 0.1s cubic-bezier(0.4, 0, 0.6, 1) 0s 1 reverse;
}

/* Désactiver l'animation CSS native quand on ferme via drag */
.popin-overlay--drag-closing .popin-content,
.popin-content--drag-closing {
  animation: none !important;
}

.popin-overlay--drag-closing {
  transition: none !important;
}



/* Overlay fade */
.popin-enter-active.popin-overlay,
.popin-leave-active.popin-overlay {
  transition: opacity 0.3s ease;
}

.popin-enter-from,
.popin-leave-to {
  opacity: 0;
}

/* Mobile adjustments */
@media (max-width: 640px) {
  .popin-content {
    padding: 32px;
    gap: 10px;
    width: calc(100vw - 20px);
    max-height: calc(100dvh - 24px);
    box-sizing: border-box;
  }
}

@media (max-width: 520px) {
  .popin-overlay {padding: 0px;}
  .popin-content {
    padding: 24px;
    border-radius: 24px 24px 0 0 ;
    position: fixed;
    max-height: calc(100dvh - 80px);
    bottom: 0px;
  }
}

/* Sidebar animations */
@keyframes slideInLeft {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(0);
  }
}

@keyframes popinSlideUp {
  0% {
    opacity: 0;
    transform: translateY(100px);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
