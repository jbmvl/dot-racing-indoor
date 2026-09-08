import { ref, computed, watch, onUnmounted } from 'vue'

/**
 * Composable: useBottomSheet
 * ---------------------------
 * Gère le comportement mobile bottom sheet avec états personnalisables
 * et interactions tactiles fluides (drag + snap).
 * 
 * États disponibles:
 * - COLLAPSED: minimal (par défaut ~35px visible) - État de snap
 * - HALF: demi-hauteur (par défaut ~200px visible) - État de snap
 * - MEDIUM: hauteur intermédiaire (par défaut 50% de l'écran) - État virtuel (pas de snap)
 * - EXPANDED: hauteur maximale (par défaut hauteur totale - 50px marge) - État de snap
 * - AUTO: s'adapte au contenu - État virtuel (pas de snap)
 * 
 * Note: MEDIUM et AUTO sont des états "virtuels" utilisés uniquement pour le positionnement
 * initial. Lors du drag, le snap se fait uniquement sur COLLAPSED, HALF et EXPANDED.
 * 
 * @param {Object} options
 * @param {Ref<Boolean>} options.isOpen - Réactivité sur l'ouverture/fermeture
 * @param {Function} options.onClose - Callback de fermeture
 * @param {Object} options.customHeights - Hauteurs personnalisées (optionnel)
 * @param {String} options.initialState - État initial (défaut: HALF)
 */

const STATES = {
  COLLAPSED: 'collapsed',  // État de snap
  HALF: 'half',            // État de snap
  MEDIUM: 'medium',        // État virtuel (positionnement initial uniquement)
  EXPANDED: 'expanded',    // État de snap
  AUTO: 'auto'             // État virtuel (positionnement initial uniquement)
}

// Délai pendant lequel le clic synthétique qui suit un drag est ignoré.
const POST_DRAG_CLICK_IGNORE_MS = 300

const DEFAULT_HEIGHTS = {
  COLLAPSED: 35,  // px visibles
  HALF: 200,       // px visibles
  MEDIUM: 0.5,    // 50% du viewport (valeur < 1 = pourcentage)
  MARGIN_TOP: 80  // marge en haut quand expanded (safe area + menu)
}

export function useBottomSheet({ isOpen, onClose, customHeights = {}, initialState = STATES.HALF }) {
  const contentEl = ref(null)
  const currentState = ref(initialState)
  const isAnimatingOpen = ref(false)
  const autoHeightTrigger = ref(0) // Trigger pour forcer le recalcul du state AUTO
  
  // Merge custom heights with defaults
  const HEIGHTS = { ...DEFAULT_HEIGHTS, ...customHeights }
  
  // Touch tracking
  const lastDragEndAt = ref(0)
  const touchStartY = ref(0)
  const touchCurrentY = ref(0)
  const isDragging = ref(false)
  const dragTranslateY = ref(0)
  
  // Scroll tracking
  const scrollTop = ref(0)
  
  // Computed: le scroll est désactivé dans les états réduits/virtuels (COLLAPSED, HALF, MEDIUM, AUTO)
  // MEDIUM et AUTO sont des états de positionnement initial uniquement, pas d'états de snap
  const shouldDisableScroll = computed(() => {
    return currentState.value === STATES.COLLAPSED || 
           currentState.value === STATES.HALF ||
           currentState.value === STATES.MEDIUM ||
           currentState.value === STATES.AUTO
  })
  
  // Computed: hauteur totale disponible et translate pour chaque état
  const viewportHeight = computed(() => {
    if (typeof window === 'undefined') return 600
    return window.innerHeight
  })
  
  const maxHeight = computed(() => viewportHeight.value - HEIGHTS.MARGIN_TOP)
  
  const stateTranslates = computed(() => {
    const vh = viewportHeight.value
    const mh = maxHeight.value
    
    const translates = {
      [STATES.COLLAPSED]: mh - HEIGHTS.COLLAPSED,
      [STATES.EXPANDED]: HEIGHTS.MARGIN_TOP
    }
    
    // HALF: peut être un nombre fixe ou un pourcentage
    if (typeof HEIGHTS.HALF === 'number' && HEIGHTS.HALF < 1) {
      translates[STATES.HALF] = vh * (1 - HEIGHTS.HALF)
    } else {
      translates[STATES.HALF] = mh - HEIGHTS.HALF
    }
    
    // MEDIUM: peut être un nombre fixe ou un pourcentage
    if (typeof HEIGHTS.MEDIUM === 'number' && HEIGHTS.MEDIUM < 1) {
      translates[STATES.MEDIUM] = vh * (1 - HEIGHTS.MEDIUM)
    } else {
      translates[STATES.MEDIUM] = mh - HEIGHTS.MEDIUM
    }
    
    // AUTO: utilise la hauteur du contenu si disponible
    if (contentEl.value && currentState.value === STATES.AUTO) {
      // Force reactivity avec le trigger
      const _ = autoHeightTrigger.value
      
      // Utiliser scrollHeight du premier enfant direct (tutorial-wrapper)
      const wrapper = contentEl.value.querySelector('.tutorial-wrapper')
      const contentHeight = wrapper ? wrapper.scrollHeight + 60 : contentEl.value.scrollHeight
      // Limiter entre MARGIN_TOP et une hauteur raisonnable
      const autoTranslate = Math.max(HEIGHTS.MARGIN_TOP, vh - contentHeight)
      translates[STATES.AUTO] = Math.min(autoTranslate, mh - HEIGHTS.HALF)
      
      // Debug log
      if (process.env.NODE_ENV === 'development') {
        console.debug('[useBottomSheet] AUTO state:', {
          contentHeight,
          autoTranslate,
          final: translates[STATES.AUTO],
          wrapperHeight: wrapper?.scrollHeight,
          elementHeight: contentEl.value.scrollHeight,
          trigger: autoHeightTrigger.value
        })
      }
    } else {
      translates[STATES.AUTO] = translates[STATES.HALF]
    }
    
    return translates
  })
  
  const currentTranslate = computed(() => {
    if (isDragging.value) {
      return dragTranslateY.value
    }
    // Pendant l'animation d'ouverture, partir du bas
    if (isAnimatingOpen.value) {
      return maxHeight.value
    }
    return stateTranslates.value[currentState.value]
  })
  
  // Determine le state le plus proche en fonction d'une position Y et de la direction du drag
  // Exclut MEDIUM et AUTO qui sont des états "virtuels" pour le positionnement initial uniquement
  // Favorise EXPANDED si drag vers le haut depuis MEDIUM/AUTO, et HALF si drag vers le bas
  function snapToNearestState(translateY, deltaY = 0, fromState = null) {
    // États autorisés pour le snap : uniquement COLLAPSED, HALF, EXPANDED
    const snapStates = [STATES.COLLAPSED, STATES.HALF, STATES.EXPANDED]
    const dragDirection = deltaY < 0 ? 'up' : 'down' // deltaY négatif = drag vers le haut (translateY diminue)
    
    // Si on vient d'un état virtuel (MEDIUM ou AUTO) et qu'on a une direction claire
    const isFromVirtualState = fromState === STATES.MEDIUM || fromState === STATES.AUTO
    
    if (isFromVirtualState && Math.abs(deltaY) > 30) {
      // Drag significatif depuis un état virtuel (seuil réduit à 30px)
      const halfTranslate = stateTranslates.value[STATES.HALF]
      const expandedTranslate = stateTranslates.value[STATES.EXPANDED]
      const mediumTranslate = stateTranslates.value[STATES.MEDIUM]
      
      if (dragDirection === 'up') {
        // Drag vers le haut → aller vers EXPANDED
        // Si on est au-dessus du milieu entre MEDIUM et EXPANDED, aller à EXPANDED
        const threshold = (mediumTranslate + expandedTranslate) / 2
        if (translateY <= threshold) {
          return STATES.EXPANDED
        }
      } else {
        // Drag vers le bas → aller vers HALF
        // Si on est en-dessous du milieu entre HALF et MEDIUM, aller à HALF
        const threshold = (halfTranslate + mediumTranslate) / 2
        if (translateY >= threshold) {
          return STATES.HALF
        }
      }
    }
    
    // Sinon, snap classique au plus proche
    const distances = snapStates.map(state => ({
      state,
      distance: Math.abs(translateY - stateTranslates.value[state])
    }))
    
    distances.sort((a, b) => a.distance - b.distance)
    return distances[0].state
  }
  
  // Gestion du drag
  function onTouchStart(e) {
    if (!contentEl.value) return
    
    const touch = e.touches[0]
    touchStartY.value = touch.clientY
    touchCurrentY.value = touch.clientY
    
    scrollTop.value = contentEl.value.scrollTop || 0
  }
  
  function onTouchMove(e) {
    if (!contentEl.value) return
    
    const touch = e.touches[0]
    touchCurrentY.value = touch.clientY
    const deltaY = touchCurrentY.value - touchStartY.value
    
    const currentScrollTop = contentEl.value.scrollTop || 0
    const isAtTop = currentScrollTop === 0
    const isAtBottom = currentScrollTop + contentEl.value.clientHeight >= contentEl.value.scrollHeight - 1
    
    // En états réduits (COLLAPSED, HALF, MEDIUM), tout mouvement = drag
    if (shouldDisableScroll.value) {
      isDragging.value = true
      e.preventDefault()
      
      // Calculer la nouvelle position avec le delta
      const baseTranslate = stateTranslates.value[currentState.value]
      let newTranslate = baseTranslate + deltaY
      
      // Limiter le drag aux bornes
      const minTranslate = HEIGHTS.MARGIN_TOP
      const maxTranslate = maxHeight.value - HEIGHTS.COLLAPSED
      newTranslate = Math.max(minTranslate, Math.min(maxTranslate, newTranslate))
      
      dragTranslateY.value = newTranslate
      return
    }
    
    // En état EXPANDED/AUTO, permettre le drag seulement aux limites du scroll
    const shouldDrag = isDragging.value || 
                       (deltaY > 0 && isAtTop) || 
                       (deltaY < 0 && isAtBottom)
    
    if (shouldDrag) {
      isDragging.value = true
      e.preventDefault()
      
      // Calculer la nouvelle position avec le delta
      const baseTranslate = stateTranslates.value[currentState.value]
      let newTranslate = baseTranslate + deltaY
      
      // Limiter le drag aux bornes
      const minTranslate = HEIGHTS.MARGIN_TOP
      const maxTranslate = maxHeight.value - HEIGHTS.COLLAPSED
      newTranslate = Math.max(minTranslate, Math.min(maxTranslate, newTranslate))
      
      dragTranslateY.value = newTranslate
    }
  }
  
  function onTouchEnd() {
    if (!isDragging.value) return
    
    const finalTranslate = dragTranslateY.value
    const deltaFromStart = touchCurrentY.value - touchStartY.value
    
    // Si drag down important depuis collapsed → fermer
    if (currentState.value === STATES.COLLAPSED && deltaFromStart > 80) {
      onClose()
      isDragging.value = false
      return
    }
    
    // Sinon snap au state le plus proche (uniquement COLLAPSED, HALF, EXPANDED)
    // En passant la direction du drag et l'état actuel pour un meilleur snap depuis les états virtuels
    const targetState = snapToNearestState(finalTranslate, deltaFromStart, currentState.value)
    
    if (process.env.NODE_ENV === 'development') {
      console.debug('[useBottomSheet] Snap:', currentState.value, '→', targetState, 
        'translateY:', finalTranslate, 'deltaY:', deltaFromStart)
    }
    
    currentState.value = targetState

    lastDragEndAt.value = Date.now()
    isDragging.value = false
    touchStartY.value = 0
    touchCurrentY.value = 0
    dragTranslateY.value = 0
  }
  
  // Gestion du clic sur le contenu : n'importe quel clic déplie la sheet en
  // grand, y compris sur un élément interactif (le listener est en phase de
  // bulle, l'action propre de l'élément a déjà eu lieu et n'est pas annulée).
  function onContentClick() {
    // Ignorer si on est en train de dragger, ou juste après un drag : le clic
    // qui suit un drag descendant re-déplierait la sheet qu'on vient de réduire.
    if (isDragging.value) return
    if (Date.now() - lastDragEndAt.value < POST_DRAG_CLICK_IGNORE_MS) return
    if (currentState.value === STATES.EXPANDED) return

    currentState.value = STATES.EXPANDED
  }
  
  // Gestion du scroll
  function onScroll(e) {
    if (!contentEl.value) return
    
    // En états EXPANDED et AUTO, tracker le scroll
    if (currentState.value === STATES.EXPANDED || currentState.value === STATES.AUTO) {
      scrollTop.value = contentEl.value.scrollTop || 0
    }
  }
  
  // Setup des listeners
  function setupListeners(element) {
    if (!element) return
    
    contentEl.value = element
    
    element.addEventListener('touchstart', onTouchStart, { passive: false })
    element.addEventListener('touchmove', onTouchMove, { passive: false })
    element.addEventListener('touchend', onTouchEnd)
    element.addEventListener('scroll', onScroll, { passive: true })
    element.addEventListener('click', onContentClick)
  }
  
  function cleanupListeners() {
    if (!contentEl.value) return
    
    const el = contentEl.value
    el.removeEventListener('touchstart', onTouchStart)
    el.removeEventListener('touchmove', onTouchMove)
    el.removeEventListener('touchend', onTouchEnd)
    el.removeEventListener('scroll', onScroll)
    el.removeEventListener('click', onContentClick)
    
    contentEl.value = null
  }
  
  // Reset state quand la popin s'ouvre
  watch(isOpen, (newVal) => {
    if (newVal) {
      // Animation d'ouverture: partir du bas puis animer vers l'état initial
      isAnimatingOpen.value = true
      currentState.value = initialState
      isDragging.value = false
      dragTranslateY.value = 0
      
      // Déclencher l'animation après un tick
      setTimeout(() => {
        isAnimatingOpen.value = false
      }, 50)
    }
  })
  
  // Fonction pour changer l'état depuis l'extérieur
  function setState(newState) {
    if (STATES[newState.toUpperCase()]) {
      if (process.env.NODE_ENV === 'development') {
        console.debug('[useBottomSheet] setState:', currentState.value, '→', newState)
      }
      currentState.value = newState
      // Si AUTO, forcer le recalcul après un tick ET après que le contenu soit rendu
      if (newState === STATES.AUTO) {
        // Premier tick : laisser le DOM se mettre à jour
        setTimeout(() => {
          // Incrémenter le trigger pour forcer le recalcul du computed stateTranslates
          autoHeightTrigger.value++
        }, 150) // Délai augmenté pour laisser le temps au contenu de se rendre
      }
    } else if (process.env.NODE_ENV === 'development') {
      console.warn('[useBottomSheet] Invalid state:', newState)
    }
  }
  
  onUnmounted(() => {
    cleanupListeners()
  })
  
  return {
    // Refs
    contentEl,
    currentState,
    currentTranslate,
    isDragging,
    maxHeight,
    shouldDisableScroll,
    isAnimatingOpen,
    stateTranslates, // Expose for debugging/forcing recompute
    
    // Methods
    setupListeners,
    cleanupListeners,
    setState,
    
    // Constants
    STATES
  }
}
