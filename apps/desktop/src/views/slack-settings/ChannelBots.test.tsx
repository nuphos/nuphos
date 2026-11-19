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
  const changes: [string, boolean][] = []
  const mapping = { id: 'm1', slackWorkspaceId: 'T1', slackChannelId: 'C1', bots }

  await act(async () => {
    root.render(
      createElement(ChannelBots, {
        mapping: mapping as SlackChannelMapping,
        myBots,
        busyKey: null,
        onChange: (botSessionId, answers) => changes.push([botSessionId, answers]),
      }),
    )
  })

  return { container, changes, unmount: () => root.unmount() }
}

const picker = (container: { querySelector: (selector: string) => Element | null }) =>
  container.querySelector('[aria-label="Add my Bot"]') as HTMLButtonElement | null

test('an empty channel offers the viewer their own Bots', async () => {
  const { container, unmount } = await render([])

  assert.equal(picker(container)?.disabled, false)
  unmount()
})

test('a teammate’s Bot holds the channel: no remove control, and the picker says whose it is', async () => {
  const { container, unmount } = await render([
    {
      sessionId: 'theirs',
      title: 'Mei Bot',
      avatar: '05-rembrandt',
      mine: false,
      ownerName: 'Mei',
    },
  ])

  assert.equal(container.querySelectorAll('button[title]').length, 0)
  assert.equal(picker(container)?.disabled, true)
  assert.match(container.textContent, /One Bot per channel, and this one is Mei’s\./)
  unmount()
})

test('the viewer’s own Bot holds the channel: they take it out to choose another', async () => {
  const { container, changes, unmount } = await render([
    { sessionId: 'mine', title: 'Deploy Bot', avatar: '07-ada', mine: true, ownerName: 'Ada' },
  ])
  const remove = [...container.querySelectorAll('button[title]')]

  assert.equal(remove.length, 1)
  assert.match(remove[0]!.getAttribute('title')!, /Deploy Bot/)
  assert.equal(picker(container)?.disabled, true)
  assert.match(container.textContent, /Take yours out to choose another\./)
  await act(async () => {
    remove[0]!.click()
  })
  assert.deepEqual(changes, [['mine', false]])
  unmount()
})
