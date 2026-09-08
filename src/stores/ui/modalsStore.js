import { defineStore } from 'pinia'

// Simple id generator
let _id = 1
const genId = () => `m-${Date.now().toString(36)}-${(_id++).toString(36)}`

export const useModalsStore = defineStore('ui-modals', () => {
  const stack = [] // array of { id, name, props, openedAt }

  function open({ name, props = {}, id = genId(), singleton = false } = {}) {
    if (!name) throw new Error('modal.open requires a name')
    if (singleton) {
      const existing = stack.find((s) => s.name === name)
      if (existing) return existing.id
    }
    const item = { id, name, props, openedAt: Date.now() }
    stack.push(item)
    return id
  }

  function close(idOrName) {
    if (!idOrName) {
      // close top
      stack.pop()
      return
    }
    const idx = stack.findIndex((s) => s.id === idOrName || s.name === idOrName)
    if (idx >= 0) stack.splice(idx, 1)
  }

  function replaceTop({ name, props = {}, id = genId() } = {}) {
    if (!name) throw new Error('modal.replaceTop requires a name')
    if (stack.length === 0) {
      stack.push({ id, name, props, openedAt: Date.now() })
    } else {
      stack[stack.length - 1] = { id, name, props, openedAt: Date.now() }
    }
    return id
  }

  function closeAll() {
    stack.splice(0, stack.length)
  }

  function top() {
    return stack.length ? stack[stack.length - 1] : null
  }

  function isOpen(nameOrId) {
    return stack.some((s) => s.id === nameOrId || s.name === nameOrId)
  }

  // Expose readonly-like API (Pinia will wrap it)
  return {
    stack,
    open,
    close,
    replaceTop,
    closeAll,
    top,
    isOpen,
  }
})

export default useModalsStore
