import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('./useChatSummary', () => ({
  useChatSummary: () => ({ loaded: true, conversation: undefined, threads: [], outputs: [] }),
}))
const runtimeStates = await import('../../../lib/agentRuntimeStates')
const summaryPanel = await import('../../../lib/chatSummaryPanel')

mock.module('../../../lib/agentRuntimeStates', () => ({
  ...runtimeStates,
  useAgentRuntimeStates: () => new Map(),
}))
mock.module('../../../lib/chatSummaryPanel', () => ({
  ...summaryPanel,
  useChatSummaryDocked: () => false,
}))
mock.module('./ChatSummaryTriggers', () => ({ ChatSummaryTriggers: () => null }))

const { ChatSummaryPanel } = await import('./ChatSummaryPanel')
const { useSummaryMotion } = await import('./summaryPlacement')

const SLIDES_IN = /t-summary-in|t-summary-slot-in/

// #4072: with the panel open, switching to another Bot or Task mounts it again,
// and it slid in again each time.
test('a panel mounted open, as when another chat takes the pane, does not slide in', () => {
  const markup = renderToStaticMarkup(
    <ChatSummaryPanel
      open
      sessionId="bot-2"
      teamId="team"
      onOpenLink={() => {}}
      onOpenSession={() => {}}
      onOpenRequest={() => {}}
      requests={[]}
      requestsLoaded
      requestsFailed={false}
    />,
  )

  assert.match(markup, /<aside/)
  assert.doesNotMatch(markup, SLIDES_IN)
})

test('a panel slides in when it opens and out when it closes', async () => {
  const dom = new Window()
  const values = { window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true }
  const originals = Object.keys(values).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )

  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(dom.document.createElement('div') as unknown as HTMLElement)
  const seen: unknown[] = []
  const Probe = ({ open }: { open: boolean }) => {
    const { mounted, motion } = useSummaryMotion(open)

    seen.push(mounted && motion)

    return null
  }

  try {
    await act(() => root.render(createElement(Probe, { open: false })))
    await act(() => root.render(createElement(Probe, { open: true })))
    assert.equal(seen.at(-1), 'in')
    await act(() => root.render(createElement(Probe, { open: false })))
    assert.equal(seen.at(-1), 'out')
    // Mounted open, then reopened while it slides shut: it slides in again.
    await act(() => root.render(createElement(Probe, { open: true, key: 'b' })))
    assert.equal(seen.at(-1), null)
    await act(() => root.render(createElement(Probe, { open: false, key: 'b' })))
    await act(() => root.render(createElement(Probe, { open: true, key: 'b' })))
    assert.equal(seen.at(-1), 'in')
  } finally {
    act(() => root.unmount())
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete (globalThis as Record<string, unknown>)[key]
    }
  }
})
