import assert from 'node:assert/strict'
import { test } from 'node:test'

import { attachSidebarSwipe } from './sidebar-swipe-controller.ts'
import { pageAtSlot, slotOf, trackStep } from './sidebar-tab-order.ts'

import type { SidebarTabOrder } from './sidebar-tab-order.ts'
import type { SidebarPage } from './swipe-gesture.ts'

test('a new order jumps the track to the open page; a new page slides', () => {
  const order: SidebarTabOrder = [0, 1, 2]

  assert.deepEqual(trackStep(order, order, 2), { slot: 2, jump: false })
  assert.deepEqual(trackStep(order, [2, 0, 1], 2), { slot: 0, jump: true })
  assert.deepEqual(
    trackStep(order, [0, 1, 2], 1),
    { slot: 1, jump: false },
    'an equal order in a new array is not a reorder',
  )
  assert.equal(pageAtSlot([2, 0, 1], 1), 0)
})

// The real controller, driven as `useSidebarSwipe` drives it: slots in, pages out.
test('the swipe track follows the tab order, and a reorder moves it without a page change', async (context) => {
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
  const pages: SidebarPage[] = []
  let order: SidebarTabOrder = [1, 0, 2]
  // Tasks first, Bots open: Bots sits in the second slot.
  const controller = attachSidebarSwipe(
    viewport as HTMLDivElement,
    layer as HTMLDivElement,
    slotOf(order, 0),
    (slot) => pages.push(pageAtSlot(order, slot)),
  )

  context.after(() => {
    controller.destroy()
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
  const swipe = async (deltaX: number) => {
    viewport.dispatchEvent(
      Object.assign(new Event('wheel', { cancelable: true }), {
        deltaX,
        deltaY: 0,
        deltaMode: 0,
        ctrlKey: false,
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 120))
  }

  assert.equal(layer.style.transform, 'translate3d(-248px,0,0)')
  await swipe(80)
  assert.deepEqual(pages, [2], 'swiping on from Bots reaches the Inbox, the next tab on screen')
  assert.equal(layer.style.transform, 'translate3d(-496px,0,0)')

  // Drag the Inbox to the front while it is open.
  const next: SidebarTabOrder = [2, 1, 0]
  const step = trackStep(order, next, 2)

  order = next
  assert.equal(step.jump, true)
  controller.place(step.slot)
  assert.equal(layer.style.transform, 'translate3d(0px,0,0)', 'the open page stays in view')
  assert.deepEqual(pages, [2], 'a reorder is not a page change')

  await swipe(80)
  assert.deepEqual(pages, [2, 1], 'the next swipe follows the new order: Tasks')
  await swipe(-80)
  assert.deepEqual(pages, [2, 1, 2], 'and back to the Inbox, now the first tab')
  assert.equal(layer.style.transform, 'translate3d(0px,0,0)')
})
