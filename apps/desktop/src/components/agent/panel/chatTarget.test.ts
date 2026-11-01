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
    getComputedStyle: (node: { overflowY?: string }) => ({
      overflowY: node.overflowY ?? 'visible',
    }),
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

/** A scrolling transcript inside an app shell that clips overflow and must never move. */
function transcript(onScroll: (top: number) => void) {
  const shell = {
    overflowY: 'hidden',
    scrollHeight: 2000,
    clientHeight: 800,
    parentElement: null,
    scrollTo: () => assert.fail('the app shell never scrolls'),
  }

  return {
    overflowY: 'auto',
    scrollHeight: 5000,
    clientHeight: 600,
    scrollTop: 1000,
    parentElement: shell,
    getBoundingClientRect: () => ({ top: 100 }),
    scrollTo: ({ top }: { top: number }) => onScroll(top),
  }
}

function target(toggle: ReturnType<typeof disclosure>, calls: string[], anchor = false) {
  return {
    hasAttribute: () => anchor,
    closest: () => ({ querySelector: () => toggle }),
    parentElement: transcript(() => calls.push('scroll')),
    offsetHeight: 100,
    getBoundingClientRect: () => ({ top: 900 }),
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

function card(calls: string[], attributes: Record<string, string>) {
  return {
    ...target(
      disclosure(true, () => {}),
      calls,
    ),
    getAttribute: (name: string) => attributes[name] ?? null,
  }
}

test("a question whose recorded id is not the transcript's own is found as its answer would map", (t) => {
  browser(t)
  const calls: string[] = []
  const other = card(calls, { 'data-tool-call-id': 'exec-0', 'data-decision-question': 'Cat?' })
  const older = card(calls, {
    'data-tool-call-id': 'exec-1',
    'data-decision-question': 'Red or blue?',
    'data-decision-options': '["red","blue"]',
  })
  const newer = card(calls, {
    'data-tool-call-id': 'exec-2',
    'data-decision-question': 'Red or blue?',
  })
  let found: unknown
  const root = {
    isConnected: true,
    querySelector: () => null,
    querySelectorAll: () => [other, older, newer],
  } as unknown as HTMLElement

  older.parentElement = transcript(() => {
    found = older
    calls.push('scroll')
  })
  assert.equal(
    locateChatTarget(root, {
      toolCallId: 'nuphos-1',
      question: 'Red or blue?',
      options: ['red', 'blue'],
    }),
    true,
  )
  assert.equal(found, older)
  assert.equal(
    locateChatTarget(root, {
      toolCallId: 'nuphos-2',
      question: 'Red or blue?',
      options: ['green'],
    }),
    true,
    'the card without options still matches',
  )
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

test('the card is centered by scrolling its transcript alone', (t) => {
  browser(t)
  const tops: number[] = []
  const element = {
    ...target(
      disclosure(true, () => {}),
      [],
    ),
    parentElement: transcript((top) => tops.push(top)),
  }
  const root = { isConnected: true, querySelector: () => element } as unknown as HTMLElement

  assert.equal(locateChatTarget(root, { toolCallId: 'tool-1' }), true)
  // 800px below the transcript's top, 1000px already scrolled, centered in 600px around 100px.
  assert.deepEqual(tops, [1000 + 800 - (600 - 100) / 2])
})
