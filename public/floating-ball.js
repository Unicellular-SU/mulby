const ball = document.getElementById('ball')
const label = document.getElementById('label')
const api = window.floatingBall

let isPointerDown = false
let isDragging = false
let longPressTimer = null
let longPressTriggered = false
let startScreenX = 0
let startScreenY = 0
let lastClickAt = 0
let activePointerId = null

const DRAG_THRESHOLD = 5
const DOUBLE_CLICK_MS = 280
const LONG_PRESS_MS = 520

function clearLongPressTimer() {
  if (!longPressTimer) return
  clearTimeout(longPressTimer)
  longPressTimer = null
}

function releaseActivePointerCapture() {
  if (activePointerId === null) return
  try {
    if (ball.hasPointerCapture(activePointerId)) {
      ball.releasePointerCapture(activePointerId)
    }
  } catch {
    // The pointer may already be released if the window was hidden.
  }
  activePointerId = null
}

function setStatus(status) {
  ball.classList.toggle('is-busy', status === 'busy')
  ball.classList.toggle('is-success', status === 'success')
  ball.classList.toggle('is-error', status === 'error')
}

function applyState(state) {
  if (!state) return
  label.textContent = state.label || 'M'
  if (typeof state.size === 'number') {
    document.documentElement.style.setProperty('--floating-ball-size', `${state.size}px`)
  }
  if (typeof state.shadowPadding === 'number') {
    document.documentElement.style.setProperty('--floating-ball-shadow-padding', `${state.shadowPadding}px`)
  }
  if (typeof state.opacity === 'number') {
    ball.style.opacity = String(state.opacity)
  }
  setStatus(state.status || 'idle')
  if (state.message) {
    ball.title = state.message
  } else {
    ball.title = 'Mulby'
  }
}

function finishPointerAction() {
  ball.classList.remove('is-pressing')
  ball.classList.remove('is-dragging')
  releaseActivePointerCapture()
  clearLongPressTimer()
}

ball.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return
  isPointerDown = true
  isDragging = false
  longPressTriggered = false
  startScreenX = event.screenX
  startScreenY = event.screenY
  ball.classList.add('is-pressing')
  ball.setPointerCapture(event.pointerId)
  activePointerId = event.pointerId

  clearLongPressTimer()
  longPressTimer = setTimeout(() => {
    if (!isPointerDown || isDragging) return
    longPressTimer = null
    isPointerDown = false
    longPressTriggered = true
    isDragging = false
    lastClickAt = 0
    finishPointerAction()
    api.longPress()
  }, LONG_PRESS_MS)
})

ball.addEventListener('pointermove', (event) => {
  if (!isPointerDown) return
  if (longPressTriggered) return
  const dx = event.screenX - startScreenX
  const dy = event.screenY - startScreenY
  if (!isDragging && Math.sqrt(dx * dx + dy * dy) >= DRAG_THRESHOLD) {
    isDragging = true
    clearLongPressTimer()
    ball.classList.remove('is-pressing')
    ball.classList.add('is-dragging')
    api.dragStart({ screenX: startScreenX, screenY: startScreenY })
  }
  if (isDragging) {
    api.dragging({ screenX: event.screenX, screenY: event.screenY })
  }
})

ball.addEventListener('pointerup', () => {
  if (!isPointerDown) return
  isPointerDown = false
  longPressTriggered = false
  finishPointerAction()

  if (isDragging) {
    isDragging = false
    api.dragEnd()
    return
  }

  const now = Date.now()
  if (now - lastClickAt <= DOUBLE_CLICK_MS) {
    lastClickAt = 0
    api.doubleClick()
  } else {
    lastClickAt = now
    setTimeout(() => {
      if (lastClickAt !== now) return
      lastClickAt = 0
      api.click()
    }, DOUBLE_CLICK_MS)
  }
})

ball.addEventListener('pointercancel', () => {
  isPointerDown = false
  isDragging = false
  longPressTriggered = false
  finishPointerAction()
})

ball.addEventListener('contextmenu', (event) => {
  event.preventDefault()
  api.contextMenu()
})

document.addEventListener('dragover', (event) => {
  event.preventDefault()
  event.stopPropagation()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  ball.classList.add('is-file-hover')
})

document.addEventListener('dragleave', (event) => {
  event.preventDefault()
  event.stopPropagation()
  ball.classList.remove('is-file-hover')
})

document.addEventListener('drop', (event) => {
  event.preventDefault()
  event.stopPropagation()
  ball.classList.remove('is-file-hover')

  const files = Array.from(event.dataTransfer?.files || [])
  if (files.length === 0) return
  const resolved = api.resolveDroppedFiles(files)
  if (resolved.length > 0) {
    api.fileDrop(resolved)
  }
})

api.onState(applyState)
api.getState().then(applyState).catch(() => {})
