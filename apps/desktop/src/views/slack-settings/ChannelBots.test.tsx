import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { SlackChannelBot, SlackChannelMapping } from '../../types'

const { ChannelBots } = await import('./ChannelBots')

const myBots = [
  { sessionId: 'mine', title: 'Deploy Bot', avatar: '07-ada' },
  { sessionId: 'spare', title: 'Spare Bot', avatar: '02-leonardo' },
]

async function render(bots: SlackChannelBot[]) {
  const dom = new Window()

  for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const { createRoot } = await import('react-dom/client')
  const container = dom.document.createElement('div')
  const root = createRoot(container as unknown as HTMLElement)
  const mapping = { id: 'm1', slackWorkspaceId: 'T1', slackChannelId: 'C1', bots }

  await act(async () => {
    root.render(
      createElement(ChannelBots, {
        mapping: mapping as SlackChannelMapping,
        myBots,
        busyKey: null,
        onChange: () => {},
      }),
    )
  })

  return { container, unmount: () => root.unmount() }
}

const picker = (container: { querySelector: (selector: string) => Element | null }) =>
  container.querySelector('[aria-label="Bot for this channel"]') as HTMLButtonElement | null

test('an empty channel offers one choice among the viewer’s own Bots', async () => {
  const { container, unmount } = await render([])

  assert.equal(picker(container)?.disabled, false)
  assert.match(picker(container)!.textContent, /Choose a Bot/)
  unmount()
})

test('a teammate’s Bot is the channel’s one Bot: shown, not changeable, and whose it is', async () => {
  const { container, unmount } = await render([
    {
      sessionId: 'theirs',
      title: 'Mei Bot',
      avatar: '05-rembrandt',
      mine: false,
      ownerName: 'Mei',
    },
  ])

  assert.equal(picker(container)?.disabled, true)
  assert.match(picker(container)!.textContent, /Mei Bot/)
  assert.match(container.textContent, /Mei’s Bot\. Only they can change it\./)
  unmount()
})

test('the viewer’s own Bot is the channel’s one Bot: chosen in the same picker, no chips', async () => {
  const { container, unmount } = await render([
    { sessionId: 'mine', title: 'Deploy Bot', avatar: '07-ada', mine: true, ownerName: 'Ada' },
  ])

  assert.equal(picker(container)?.disabled, false)
  assert.match(picker(container)!.textContent, /Deploy Bot/)
  // One choice, not a set: no per-Bot remove control beside it.
  assert.equal(container.querySelectorAll('button[title]').length, 0)
  unmount()
})
