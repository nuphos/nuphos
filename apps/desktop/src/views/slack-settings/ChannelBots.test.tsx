import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { SlackChannelMapping } from '../../types'

const { ChannelBots } = await import('./ChannelBots')

const mapping = {
  id: 'm1',
  slackWorkspaceId: 'T1',
  slackChannelId: 'C1',
  bots: [
    { sessionId: 'mine', title: 'Deploy Bot', avatar: '07-ada', mine: true },
    { sessionId: 'theirs', title: 'Mei’s Bot', avatar: '05-rembrandt', mine: false },
  ],
} as SlackChannelMapping

test('a member removes only their own Bot, and is offered only their own Bots to add', async () => {
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

  await act(async () => {
    root.render(
      createElement(ChannelBots, {
        mapping,
        myBots: [
          { sessionId: 'mine', title: 'Deploy Bot', avatar: '07-ada' },
          { sessionId: 'spare', title: 'Spare Bot', avatar: '02-curie' },
        ],
        busyKey: null,
        onChange: (botSessionId, answers) => changes.push([botSessionId, answers]),
      }),
    )
  })

  assert.match(container.textContent, /Deploy Bot.*Mei’s Bot/)
  const remove = [...container.querySelectorAll('button[title]')]

  // Only the viewer's own Bot can be taken out.
  assert.equal(remove.length, 1)
  assert.match(remove[0]!.getAttribute('title')!, /Deploy Bot/)
  // The picker offers the viewer's Bots, and none of them is already here.
  assert.ok(container.querySelector('[aria-label="Add my Bot"]'))
  await act(async () => {
    remove[0]!.click()
  })
  assert.deepEqual(changes, [['mine', false]])
  root.unmount()
})
