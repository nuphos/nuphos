import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { ReactNode } from 'react'

const none = () => null

mock.module('../../components/agent/AgentPanel', () => ({ AgentPanel: none }))
mock.module('../../components/agent/summary/ChatSummaryPanel', () => ({
  ChatSummaryPanel: ({ open, sessionId }: { open: boolean; sessionId: string }) =>
    open ? createElement('aside', { 'aria-label': 'Task summary' }, sessionId) : null,
}))
mock.module('../../components/agent/summary/useSessionInputRequests', () => ({
  useSessionInputRequests: () => ({ requests: [], loaded: true, failed: false }),
}))
mock.module('../../components/SkeletonReveal', () => ({
  SkeletonReveal: ({ children }: { children: ReactNode }) => children,
}))
mock.module('../../hooks/useDetailSidebarTransition', () => ({
  useDetailSidebarTransition: (onBack: () => void) => ({
    contentOpen: true,
    open: true,
    panelRef: { current: null },
    requestClose: onBack,
  }),
}))
mock.module('./CornerSidebarToggle', () => ({
  CornerSidebarToggle: none,
  CORNER_TITLEBAR_CLASS: '',
}))

const dom = new Window()

const neverResponds = () =>
  new Promise<never>(() => {
    /* No live API during the fixture. */
  })

Object.assign(dom, { api: new Proxy({}, { get: () => neverResponds }) })
const browser: Record<string, unknown> = {
  window: dom,
  navigator: dom.navigator,
  IS_REACT_ACT_ENVIRONMENT: true,
}

for (const key of Object.getOwnPropertyNames(dom))
  if (!(key in globalThis)) browser[key] = Reflect.get(dom, key)
for (const [key, value] of Object.entries(browser))
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })

const { createRoot } = await import('react-dom/client')
const { BotTaskMode } = await import('./BotTaskMode')
const { WorkspacePaneContext } = await import('./WorkspacePaneContext')
const { setPaneSession, setChatSummaryOpen, isChatSummaryOpen } =
  await import('../../lib/chatSummaryPanel')

test('a Bot Task exposes its summary without changing the underlying conversation summary', async () => {
  setPaneSession('bot-pane', 'bot-chat')
  setChatSummaryOpen('bot-pane', true)
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  let returned = false
  const ws = { dockOpen: false, stableOpenSessionResource: none } as never
  const props = {
    ws,
    user: { id: 'me', name: 'Me' } as never,
    teamId: 'team',
    sessionId: 'bot',
    onSessionChange: none,
    onBack: () => {
      returned = true
    },
  }
  const render = () =>
    root.render(
      createElement(
        WorkspacePaneContext,
        { value: { paneId: 'bot-pane', active: true, cornerPane: false } as never },
        createElement(BotTaskMode, props),
      ),
    )

  try {
    await act(render)
    const toggle = container.querySelector<HTMLButtonElement>('[aria-label="Toggle task summary"]')

    assert.ok(toggle, 'Bot Task has the ordinary Task summary control')
    assert.equal(container.querySelector('aside'), null)
    await act(() => toggle.click())
    assert.equal(container.querySelector('aside')?.textContent, 'bot')
    assert.equal(isChatSummaryOpen('bot-pane'), true)
    props.sessionId = 'second-bot'
    await act(render)
    assert.equal(
      container.querySelector('aside'),
      null,
      'switching Tasks closes the previous summary',
    )
    await act(() => toggle.click())
    assert.equal(container.querySelector('aside')?.textContent, 'second-bot')
    await act(() => toggle.click())
    assert.equal(container.querySelector('aside'), null)
    assert.equal(isChatSummaryOpen('bot-pane'), true)
    const back = [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('Back to conversation'),
    )

    await act(() => back?.click())
    assert.equal(returned, true)
  } finally {
    await act(() => root.unmount())
    assert.equal(isChatSummaryOpen('bot-pane'), true)
    setChatSummaryOpen('bot-pane', false)
    setPaneSession('bot-pane', null)
    await dom.happyDOM.close()
  }
})
