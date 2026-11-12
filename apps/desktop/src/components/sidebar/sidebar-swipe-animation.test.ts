import assert from 'node:assert/strict'
import { test } from 'node:test'

import { attachSidebarSwipe } from './sidebar-swipe-controller.ts'

test('conversation activation waits for settling and interrupted animations cannot activate stale pages', (context) => {
  let reduced = false
  const globals = {
    window: { matchMedia: () => ({ matches: reduced }) },
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0)

      return 1
    },
    cancelAnimationFrame: () => {},
    getComputedStyle: () => ({ transform: 'matrix(1,0,0,1,-100,0)' }),
    DOMMatrixReadOnly: class {
      m41 = -100
    },
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  }
  const descriptors = Object.keys(globals).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )

  Object.defineProperties(
    globalThis,
    Object.fromEntries(
      Object.entries(globals).map(([key, value]) => [key, { value, configurable: true }]),
    ),
  )
  const viewport = Object.assign(new EventTarget(), { clientWidth: 248 })
  const animations: { onfinish: (() => void) | null; cancel: () => void }[] = []
  const layer = {
    style: { transform: '' },
    animate: () => {
      const animation = { onfinish: null as (() => void) | null, cancel: () => {} }

      animations.push(animation)

      return animation
    },
  }
  const changes: number[] = []
  const controller = attachSidebarSwipe(
    viewport as HTMLDivElement,
    layer as unknown as HTMLDivElement,
    0,
    (page) => changes.push(page),
  )

  context.after(() => {
    controller.destroy()
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
  const wheel = (deltaX: number) =>
    viewport.dispatchEvent(
      Object.assign(new Event('wheel', { cancelable: true }), {
        deltaX,
        deltaY: 0,
        deltaMode: 0,
        ctrlKey: false,
      }),
    )

  controller.nativePhase('begin')
  wheel(80)
  controller.nativePhase('end')
  assert.deepEqual(
    changes,
    [],
    'opening a heavy conversation must not compete with the settling animation',
  )
  animations[0].onfinish?.()
  assert.deepEqual(changes, [1])

  controller.nativePhase('begin')
  wheel(-80)
  controller.nativePhase('end')
  const obsoleteFinish = animations[1].onfinish

  controller.nativePhase('begin')
  obsoleteFinish?.()
  assert.deepEqual(changes, [1], 'an interrupted animation cannot navigate later')
  wheel(80)
  controller.nativePhase('end')
  animations.at(-1)?.onfinish?.()
  assert.deepEqual(changes, [1, 1])

  reduced = true
  controller.go(0)
  assert.deepEqual(changes, [1, 1, 0], 'reduced motion activates immediately')
})
