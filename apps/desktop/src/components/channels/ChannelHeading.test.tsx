import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

const dom = new Window()
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
const { ChannelHeading } = await import('./BotDetails')
const { isBotDetailsOpen, setBotDetailsOpen } = await import('../../lib/botDetailsPanel')

test("a Bot chat's heading is one button that opens its details, and closes them again", async () => {
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)

  await act(() =>
    root.render(
      createElement(ChannelHeading, {
        teamId: 'team-a',
        chat: { sessionId: 'chat-1', faces: [{ id: 'bot-1', agent: true }] as never },
        title: 'Scribe',
        visible: true,
      }),
    ),
  )
  const button = container.querySelector<HTMLButtonElement>('button[data-summary-toggle]')

  assert.ok(button)
  assert.equal(button.getAttribute('aria-label'), 'Bot details')
  // The heading clips what overflows it: nothing pulls the button past its left edge.
  assert.doesNotMatch(button.className, /-ml-/)
  // A chevron says it opens something, and flips once it has.
  assert.match(
    [...button.querySelectorAll('svg')].at(-1)?.getAttribute('class') ?? '',
    /lucide-chevron-right.*group-aria-expanded:rotate-180/,
  )
  assert.equal(button.getAttribute('aria-expanded'), 'false')
  await act(() => button.click())
  assert.equal(isBotDetailsOpen('bot-1'), true)
  assert.equal(button.getAttribute('aria-expanded'), 'true')
  await act(() => button.click())
  assert.equal(isBotDetailsOpen('bot-1'), false)
  setBotDetailsOpen('bot-1', false)
  await act(() => root.unmount())
})
