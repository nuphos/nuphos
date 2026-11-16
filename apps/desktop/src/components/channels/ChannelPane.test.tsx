import assert from 'node:assert/strict'

import { QueryClientProvider } from '@tanstack/react-query'
import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { AgentConversation } from '../../api'
import type { UserInfo } from '../../types'
import type { Composer } from '../agent/panel/Composer'
import type { ComponentProps } from 'react'

type ComposerProps = ComponentProps<typeof Composer>

// What the composer was handed, one entry per render.
const frames: ComposerProps[] = []

mock.module('../agent/panel/Composer', () => ({
  Composer: (props: ComposerProps) => {
    frames.push(props)

    return null
  },
}))

const dom = new Window()
// No request answers during the test: only what is known before the chat loads is drawn.
const pending = new Proxy({}, { get: () => () => new Promise(() => {}) })

Object.assign(dom, { api: pending })
// The app's modules read browser globals as they load: every one the window has, once.
const browser: Record<string, unknown> = {
  window: dom,
  navigator: dom.navigator,
  IS_REACT_ACT_ENVIRONMENT: true,
}

for (const key of Object.getOwnPropertyNames(dom))
  if (!(key in globalThis)) browser[key] = Reflect.get(dom, key)
for (const [key, value] of Object.entries(browser))
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })

const { queryClient } = await import('../../lib/query/client')
const { queryKeys } = await import('../../lib/query/keys')
const { ChannelPane } = await import('./ChannelPane')
const { createRoot } = await import('react-dom/client')

const row = (fields: Partial<AgentConversation> & { sessionId: string }): AgentConversation => ({
  title: '',
  firstMessage: '',
  messageCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastActiveAt: '2026-01-01T00:00:00.000Z',
  ...fields,
})

test('a listed Bot chat opens with its name, runtime and credentials before it loads', async () => {
  // The sidebar has listed the Bot and its chat; the chat itself has never been opened.
  queryClient.setQueryData<AgentConversation[]>(queryKeys.agentSessions('team'), [
    row({
      sessionId: 'chat',
      kind: 'channel',
      title: 'Ada',
      faces: [{ id: 'bot', name: 'Ada', agent: {} }],
    }),
    row({
      sessionId: 'bot',
      title: 'Ada',
      isOwner: true,
      agentRuntime: 'claude-code',
      runtimeId: 'runtime-1',
      runtimeLabel: 'Claude Code on a laptop',
      credentialAccess: {
        personalCredentialIds: ['github'],
      } as AgentConversation['credentialAccess'],
    }),
  ])
  let settingsOpened = 0
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)

  await act(() =>
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(ChannelPane, {
          teamId: 'team',
          channelId: 'chat',
          user: { id: 'me', name: 'Me' } as UserInfo,
          dockOpen: false,
          fixes: { onOpenAgentSettings: () => settingsOpened++ },
          onOpenSession: () => {},
        }),
      ),
    ),
  )

  assert.ok(frames.length > 0)
  // Every frame, the first one included: a frame without them is the composer jumping.
  for (const frame of frames) {
    assert.equal(frame.placeholder, 'Message Ada')
    assert.equal(frame.runtimeControl?.value?.label, 'Claude Code on a laptop')
    assert.deepEqual(frame.credentialSelector?.value.personalCredentialIds, ['github'])
  }
  assert.ok(frames.at(-1)?.runtimeControl?.onSettings)
  frames.at(-1)?.runtimeControl?.onSettings?.()
  assert.equal(settingsOpened, 1)
  await act(() => root.unmount())
  queryClient.clear()
})
