import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { AgentMessageMetadata } from '../../../api/agent-types'
import type { ReactNode } from 'react'

mock.module('../MessageResponse', () => ({
  MessageResponse: ({ children }: { children: ReactNode }) => createElement('div', null, children),
}))

const { AgentEventMessage } = await import('./AgentEventMessage')
const { parseMessageMetadata } = await import('./messageMetadata')
const { usePostJump } = await import('../../channels/postJump')

const wake = (channelPost?: unknown) =>
  parseMessageMetadata({
    version: 1,
    sender: { type: 'system', id: 'channel:ops', displayName: 'ops' },
    source: 'agent.resource',
    sentAt: '2026-11-16T05:00:00.000Z',
    channelPost,
  })!

test('a channel wake names the newest post in one line that opens the channel at it', async () => {
  const dom = new Window()
  const values = {
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  }

  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const { createRoot } = await import('react-dom/client')
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  const opened: string[] = []
  let jump: string | undefined
  const Jump = () => {
    jump = usePostJump('ops')

    return null
  }
  const render = (metadata: AgentMessageMetadata) =>
    act(() =>
      root.render(
        createElement(
          'div',
          null,
          createElement(AgentEventMessage, {
            metadata,
            text: 'New messages in a Nuphos channel (channelId ops).',
            teamId: 'team',
            onOpenNuphosLink: (href) => opened.push(href) > 0,
          }),
          createElement(Jump),
        ),
      ),
    )

  await render(
    wake({
      id: 'post-7',
      sender: { type: 'user', id: 'mei', displayName: 'Mei Chen' },
      text: 'deploy failed on prod',
      more: 2,
    }),
  )
  const buttons = container.querySelectorAll('button')

  assert.equal(buttons.length, 1)
  assert.match(buttons[0]!.textContent!, /#ops·.*Mei Chendeploy failed on prod\+2 more/)
  await act(() => (buttons[0] as unknown as HTMLElement).click())
  assert.deepEqual(opened, ['https://nuphos.ai/teams/team/agent/ops'])
  assert.equal(jump, 'post-7')

  // A file alone, and a wake from before posts were carried: today's line.
  await render(
    wake({ id: 'p', sender: { type: 'user', id: 'mei', displayName: 'Mei' }, text: '', more: 0 }),
  )
  assert.match(container.textContent!, /Mei.*Sent a file$/)
  await render(wake())
  assert.match(container.textContent!, /New messages in#ops$/)
  await act(() => root.unmount())
})
