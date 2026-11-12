import assert from 'node:assert/strict'
import { test } from 'node:test'

import { attachSidebarSwipe } from './sidebar-swipe-controller.ts'

// Exercise the actual input controller, including its release timer. The DOM
// surface records transforms; reduced motion makes the final snap deterministic.
test('slow wheel input keeps both pages on the track until the gesture ends', async (context) => {
  const globals = {
    window: { matchMedia: () => ({ matches: true }) },
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0)

      return 1
    },
    cancelAnimationFrame: () => {
      /* Frames run synchronously in this harness. */
    },
    ResizeObserver: class {
      observe() {
        return
      }
      disconnect() {
        return
      }
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
  const layer = { style: { transform: '' } }
  const changes: number[] = []
  let ticks = 0
  const controller = attachSidebarSwipe(
    viewport as HTMLDivElement,
    layer as HTMLDivElement,
    0,
    (page) => changes.push(page),
    {
      onThreshold: () => {
        ticks++
      },
    },
  )

  context.after(() => {
    controller.destroy()
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
  const wheel = (deltaX: number, deltaY = 0) => {
    const event = Object.assign(new Event('wheel', { cancelable: true }), {
      deltaX,
      deltaY,
      deltaMode: 0,
      ctrlKey: false,
    })

    viewport.dispatchEvent(event)

    return event
  }

  // Vertical scrolling belongs to the task list, not the pager.
  assert.equal(wheel(0, 30).defaultPrevented, false)
  await new Promise((resolve) => setTimeout(resolve, 180))
  for (let step = 1; step <= 4; step++) {
    assert.equal(wheel(20).defaultPrevented, true)
    assert.equal(layer.style.transform, `translate3d(${-step * 20}px,0,0)`)
    assert.deepEqual(changes, [], 'crossing the old 44px threshold must not commit a page')
    await new Promise((resolve) => setTimeout(resolve, 45))
  }
  await new Promise((resolve) => setTimeout(resolve, 180))
  assert.deepEqual(changes, [1])
  assert.equal(layer.style.transform, 'translate3d(-248px,0,0)')

  // Drag back, then reverse before release: the track follows the whole gesture.
  wheel(-80)
  assert.equal(layer.style.transform, 'translate3d(-168px,0,0)')
  wheel(76)
  assert.equal(layer.style.transform, 'translate3d(-244px,0,0)')
  await new Promise((resolve) => setTimeout(resolve, 180))
  assert.equal(layer.style.transform, 'translate3d(-248px,0,0)')
  assert.deepEqual(changes, [1, 1])

  controller.nativePhase('begin')
  wheel(-120)
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(
    layer.style.transform,
    'translate3d(-128px,0,0)',
    'a stationary finger does not end a native gesture',
  )
  assert.equal(ticks, 0)
  wheel(-10)
  assert.equal(ticks, 1, 'crossing the midpoint produces one alignment tick')
  wheel(-1)
  assert.equal(ticks, 1, 'continuing on the same side does not repeat feedback')
  controller.nativePhase('end')
  assert.equal(
    layer.style.transform,
    'translate3d(0px,0,0)',
    'finger release snaps immediately without waiting for a timer',
  )
  wheel(-35)
  assert.equal(
    layer.style.transform,
    'translate3d(0px,0,0)',
    'trailing momentum cannot start another gesture',
  )
  controller.nativePhase('begin')
  wheel(60)
  assert.equal(
    layer.style.transform,
    'translate3d(-60px,0,0)',
    'a new physical gesture interrupts momentum suppression',
  )
  controller.nativePhase('end')
  controller.nativePhase('begin')
  wheel(160)
  controller.nativePhase('end')
  assert.equal(layer.style.transform, 'translate3d(-248px,0,0)', 'Tasks is the second page')
  controller.nativePhase('begin')
  wheel(100)
  controller.nativePhase('end')
  assert.equal(
    layer.style.transform,
    'translate3d(-248px,0,0)',
    'the second page is the final boundary',
  )
})
