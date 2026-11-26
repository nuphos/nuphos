import assert from 'node:assert/strict'

import { jest, mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { DesktopPhase } from '../lib/desktopConnection'

// noVNC over a stream that opens but never completes the handshake: it neither
// connects nor disconnects until it is told to.
const views: { disconnected: boolean }[] = []

class SilentRfb extends EventTarget {
  viewOnly = false
  scaleViewport = false
  background = ''
  readonly view = { disconnected: false }
  constructor() {
    super()
    views.push(this.view)
  }
  disconnect() {
    this.view.disconnected = true
  }
}

mock.module('@novnc/novnc', () => ({ default: SilentRfb }))
mock.module('../lib/ipcVncChannel', () => ({
  IpcVncChannel: class {
    open() {
      return this
    }
  },
}))

function setUpDom() {
  const dom = new Window()
  const values = {
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    navigator: dom.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  }

  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true, value })

  return dom
}

test('a stream whose handshake never completes fails in time and reconnects', async () => {
  const dom = setUpDom()
  const { createRoot } = await import('react-dom/client')
  const { useLiveDesktop } = await import('./useLiveDesktop')
  const phases: DesktopPhase['kind'][] = []

  function View() {
    const { host, phase } = useLiveDesktop('desktop-1', {
      teamId: 'team-1',
      sessionId: 'session-1',
      display: 0,
    })

    phases.push(phase.kind)

    return createElement('div', { ref: host })
  }
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)

  jest.useFakeTimers()
  try {
    await act(async () => {
      root.render(createElement(View))
      // noVNC is imported when the first desktop shows.
      await import('@novnc/novnc')
    })
    assert.equal(views.length, 1)

    await act(async () => {
      jest.advanceTimersByTime(8_500)
      await Promise.resolve()
    })
    assert.equal(phases.at(-1), 'reconnecting')
    assert.equal(views[0]?.disconnected, true)

    await act(async () => {
      jest.advanceTimersByTime(1_000)
      await Promise.resolve()
    })
    assert.equal(views.length, 2)
  } finally {
    await act(() => root.unmount())
    jest.useRealTimers()
  }
})
