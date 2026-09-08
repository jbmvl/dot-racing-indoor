import { defineStore } from 'pinia'

export const useBottomPanelStore = defineStore('ui-bottomPanel', () => {
  const state = {
    open: false,
    mode: 'compact', // 'compact' | 'expanded' | 'full'
    activeView: null,
    history: [],
  }

  function openPanel(view, { mode } = {}) {
    if (state.activeView && state.activeView !== view) {
      state.history.push(state.activeView)
    }
    state.activeView = view
    if (mode) state.mode = mode
    state.open = true
  }

  function closePanel() {
    state.open = false
  }

  function togglePanel(view, opts = {}) {
    if (state.open && state.activeView === view) {
      closePanel()
    } else {
      openPanel(view, opts)
    }
  }

  function setMode(mode) {
    state.mode = mode
  }

  function back() {
    const prev = state.history.pop()
    if (prev) state.activeView = prev
    else state.activeView = null
  }

  return {
    state,
    openPanel,
    closePanel,
    togglePanel,
    setMode,
    back,
  }
})

export default useBottomPanelStore
