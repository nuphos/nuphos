import { swipeDestination } from './swipe-gesture.ts'

import type { SidebarPage } from './swipe-gesture.ts'

export function attachSidebarSwipe(
  el: HTMLDivElement,
  layer: HTMLDivElement,
  page: SidebarPage,
  onPage: (page: SidebarPage) => void,
  feedback: { onThreshold?: () => void; onStart?: () => void } = {},
) {
  let selected = page
  let width = el.clientWidth
  let position = -selected * width
  let origin = position
  let distance = 0
  let velocity = 0
  let previousTime = 0
  let nativeTracking = false
  let ignoreMomentum = false
  let thresholdSide: SidebarPage = page
  const lastPage = 1
  let axis: 'x' | 'y' | null = null
  let frame = 0
  let end: ReturnType<typeof setTimeout> | undefined
  let animation: Animation | null = null
  let animationVersion = 0
  let touch: { x: number; y: number } | null = null
  const paint = (x: number) => {
    layer.style.transform = `translate3d(${String(x)}px,0,0)`
  }
  const freeze = () => {
    animationVersion++
    if (animation) {
      position = new DOMMatrixReadOnly(getComputedStyle(layer).transform).m41
      animation.cancel()
      animation = null
      paint(position)
    }
    cancelAnimationFrame(frame)
  }
  const go = (target: SidebarPage) => {
    freeze()
    const from = position

    position = -target * width
    paint(position)
    selected = target
    if (
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
      Math.abs(from - position) > 0.5
    ) {
      animation = layer.animate(
        [
          { transform: `translate3d(${String(from)}px,0,0)` },
          { transform: `translate3d(${String(position)}px,0,0)` },
        ],
        { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' },
      )
      const version = animationVersion

      animation.onfinish = () => {
        if (version !== animationVersion) return
        animation = null
        // Mounting the destination conversation can be expensive. Let the
        // compositor finish settling before asking React to open it.
        onPage(target)
      }
    } else onPage(target)
  }

  const begin = () => {
    feedback.onStart?.()
    freeze()
    origin = position
    distance = 0
    velocity = 0
    previousTime = performance.now()
    thresholdSide = selected
  }
  const move = (delta: number) => {
    const now = performance.now()

    velocity = delta / Math.max(8, now - previousTime)
    previousTime = now
    distance += delta
    const raw = origin + distance

    position = raw
    if (raw > 0) position = Math.min(24, raw * 0.15)
    if (raw < -lastPage * width)
      position = -lastPage * width - Math.min(24, (-lastPage * width - raw) * 0.15)
    // A small dead band prevents repeated ticks when resting at the midpoint.
    const progress = -position / width
    let nextSide = thresholdSide

    if (progress > thresholdSide + 0.52)
      nextSide = Math.min(lastPage, Math.floor(progress + 0.48)) as SidebarPage
    if (progress < thresholdSide - 0.52)
      nextSide = Math.max(0, Math.ceil(progress - 0.48)) as SidebarPage

    if (nextSide !== thresholdSide) {
      thresholdSide = nextSide
      feedback.onThreshold?.()
    }
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => paint(position))
  }
  const finish = () => {
    if (axis === 'x') go(swipeDestination(selected, distance, width, velocity))
    axis = null
    distance = 0
  }
  const wheel = (event: WheelEvent) => {
    if (event.ctrlKey) return
    if (ignoreMomentum) {
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) event.preventDefault()
      clearTimeout(end)
      end = setTimeout(() => {
        ignoreMomentum = false
      }, 120)

      return
    }
    let unit = 1

    if (event.deltaMode === 1) unit = 16
    if (event.deltaMode === 2) unit = width
    const delta = -event.deltaX * unit

    if (!axis && Math.max(Math.abs(event.deltaX), Math.abs(event.deltaY)) > 1) {
      axis = Math.abs(event.deltaX) > Math.abs(event.deltaY) * 1.15 ? 'x' : 'y'
      if (axis === 'x') begin()
    }
    clearTimeout(end)
    if (!nativeTracking) end = setTimeout(finish, 70)
    if (axis !== 'x') return
    event.preventDefault()
    move(delta)
  }
  const touchStart = (event: TouchEvent) => {
    begin()
    axis = null
    touch = { x: event.touches[0].clientX, y: event.touches[0].clientY }
  }
  const touchMove = (event: TouchEvent) => {
    if (!touch) return
    const dx = event.touches[0].clientX - touch.x
    const dy = event.touches[0].clientY - touch.y

    if (!axis && Math.max(Math.abs(dx), Math.abs(dy)) > 4)
      axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
    if (axis !== 'x') return
    event.preventDefault()
    move(dx - distance)
  }
  const touchEnd = () => {
    touch = null
    finish()
  }
  const resize = new ResizeObserver(() => {
    if (width === el.clientWidth) return
    width = el.clientWidth
    freeze()
    position = -selected * width
    paint(position)
  })

  paint(position)
  resize.observe(el)
  el.addEventListener('wheel', wheel, { passive: false })
  el.addEventListener('touchstart', touchStart, { passive: true })
  el.addEventListener('touchmove', touchMove, { passive: false })
  el.addEventListener('touchend', touchEnd)
  el.addEventListener('touchcancel', touchEnd)

  const destroy = () => {
    clearTimeout(end)
    freeze()
    resize.disconnect()
    el.removeEventListener('wheel', wheel)
    el.removeEventListener('touchstart', touchStart)
    el.removeEventListener('touchmove', touchMove)
    el.removeEventListener('touchend', touchEnd)
    el.removeEventListener('touchcancel', touchEnd)
  }

  return {
    nativePhase: (phase: 'begin' | 'end') => {
      clearTimeout(end)
      if (phase === 'begin') {
        feedback.onStart?.()
        freeze()
        nativeTracking = true
        ignoreMomentum = false
      } else if (nativeTracking) {
        nativeTracking = false
        ignoreMomentum = axis === 'x'
        finish()
        end = setTimeout(() => {
          ignoreMomentum = false
        }, 120)
      }
    },
    go: (target: SidebarPage) => {
      if (target !== selected) go(target)
    },
    destroy,
  }
}
