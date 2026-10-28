import assert from 'node:assert/strict'
import { test } from 'node:test'

import { locateChatTarget } from './chatTarget.ts'

import type { TestContext } from 'node:test'

function browser(t: TestContext) {
  const frames: FrameRequestCallback[] = []

  t.mock.timers.enable({ apis: ['setTimeout'] })
  for (const [key, value] of Object.entries({
    window: { setTimeout: globalThis.setTimeout },
    CSS: { escape: (id: string) => id },
    requestAnimationFrame: (callback: FrameRequestCallback) => frames.push(callback),
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key)

    Object.defineProperty(globalThis, key, { configurable: true, value })
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous)
      else Reflect.deleteProperty(globalThis, key)
    })
  }

  return () => {
    const frame = frames.shift()

    assert.ok(frame, 'a closed disclosure schedules another lookup after React renders')
    frame(0)
  }
}

function disclosure(initiallyOpen: boolean, onOpen: () => void) {
  let open = initiallyOpen

  return {
    getAttribute: () => String(open),
    click: () => {
      open = true
      onOpen()
    },
  }
}

function target(toggle: ReturnType<typeof disclosure>, calls: string[], anchor = false) {
  return {
    hasAttribute: () => anchor,
    closest: () => ({ querySelector: () => toggle }),
    scrollIntoView: () => calls.push('scroll'),
    classList: { add: () => calls.push('flash'), remove: () => calls.push('unflash') },
  }
}

test('a mounted tool hidden in a closed tool run is revealed before locating it', (t) => {
  const nextFrame = browser(t)
  const calls: string[] = []
  const toggle = disclosure(false, () => calls.push('open tool run'))
  const element = target(toggle, calls)
  const root = { isConnected: true, querySelector: () => element } as unknown as HTMLElement

  assert.equal(locateChatTarget(root, { toolCallId: 'tool-1' }), false)
  assert.deepEqual(calls, ['open tool run'])
  nextFrame()
  assert.deepEqual(calls, ['open tool run', 'scroll', 'flash'])
  assert.equal(locateChatTarget(root, { toolCallId: 'tool-1' }), true)
  assert.equal(calls.filter((call) => call === 'open tool run').length, 1)
})

test('a lazy Activity anchor and its nested tool disclosure both open before scrolling', (t) => {
  const nextFrame = browser(t)
  const calls: string[] = []
  const inner = disclosure(false, () => calls.push('open tool run'))
  const tool = target(inner, calls)
  let current = target(
    disclosure(false, () => {
      calls.push('open Activity')
      current = tool
    }),
    calls,
    true,
  )
  const root = { isConnected: true, querySelector: () => current } as unknown as HTMLElement

  assert.equal(locateChatTarget(root, { toolCallId: 'tool-1' }), false)
  assert.deepEqual(calls, ['open Activity'])
  nextFrame()
  assert.deepEqual(calls, ['open Activity', 'open tool run'])
  nextFrame()
  assert.deepEqual(calls, ['open Activity', 'open tool run', 'scroll', 'flash'])
})

test("a question whose recorded id is not the transcript's own is found by its question", (t) => {
  browser(t)
  const calls: string[] = []
  const older = target(
    disclosure(true, () => {}),
    calls,
  )
  const newer = target(
    disclosure(true, () => {}),
    calls,
  )
  const selectors: string[] = []
  const root = {
    isConnected: true,
    querySelector: (selector: string) => {
      selectors.push(selector)

      return null
    },
    querySelectorAll: (selector: string) => {
      selectors.push(selector)

      return selector.includes('data-decision-question') ? [older, newer] : []
    },
  } as unknown as HTMLElement

  assert.equal(locateChatTarget(root, { toolCallId: 'nuphos-1', question: 'Red or blue?' }), true)
  assert.deepEqual(selectors, [
    '[data-tool-call-id="nuphos-1"]',
    '[data-decision-question="Red or blue?"]',
  ])
  assert.deepEqual(calls, ['scroll', 'flash'])
})

test('a tool call that is not rendered is not mistaken for its message', (t) => {
  browser(t)
  const root = {
    isConnected: true,
    querySelector: () => null,
    querySelectorAll: () => [],
  } as unknown as HTMLElement

  assert.equal(locateChatTarget(root, { toolCallId: 'missing', question: 'Gone?' }), false)
})
