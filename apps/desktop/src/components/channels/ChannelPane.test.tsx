import assert from 'node:assert/strict'

import { QueryClientProvider } from '@tanstack/react-query'
import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { AgentConversation } from '../../api'
import type { UserInfo } from '../../types'
import type { RuntimeQuota } from '../../types/runtime'
import type { Composer } from '../agent/panel/Composer'
import type { RuntimeControl } from '../agent/panel/RuntimeSelector'
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
const neverResponds = () =>
  new Promise<never>(() => {
    /* Unrelated API calls stay pending. */
  })
const triggerQueries: unknown[][] = []
const bypassQueries: unknown[] = []
const pending = new Proxy(
  {},
  {
    get:
      (_target, key) =>
      (...args: unknown[]) => {
        if (key === 'agentListTriggers') {
          triggerQueries.push(args)

          return Promise.resolve([])
        }
        if (key === 'agentGetAutoModeBypass') {
          bypassQueries.push(args[0])

          return Promise.resolve({ bypass: true })
        }

        return neverResponds()
      },
  },
)

Object.assign(dom, { api: pending })
// happy-dom lays nothing out: the chat is wide enough for its details beside it.
Object.defineProperty(dom.HTMLElement.prototype, 'offsetWidth', { get: () => 1200 })
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
const { RuntimeSelector } = await import('../agent/panel/RuntimeSelector')
const { createRoot } = await import('react-dom/client')

const buttonNamed = (root: Element, name: string) =>
  [...root.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === name)
// Bot details' Access section: each row's text, and whether it opens anything.
const accessRows = (panel: Element) => {
  const section = panel.querySelector('section[aria-label="Access"]')

  assert.ok(section, 'Bot details has an Access section')

  return [...section.querySelectorAll('.pt-2 > *')].map((node) => ({
    text: node.textContent,
    opens: node.tagName === 'BUTTON',
  }))
}

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
      // A Task's sidebar lists these under Changes; Bot details leave them out.
      linkedResources: [
        {
          id: 'issue',
          provider: 'linear',
          title: 'Fix it',
          url: 'https://linear.app/x/issue/X-1',
          state: 'open',
          linkedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
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

  // The title bar holds the Bot's name and status, and its details open from the name.
  for (const name of ['Triggers', 'Task', 'Desktop', 'Edit Bot: Ada'])
    assert.equal(buttonNamed(container, name), undefined, `the title bar has no ${name}`)
  const toggle = buttonNamed(container, 'Bot details')

  assert.ok(toggle)
  assert.equal(toggle.getAttribute('aria-expanded'), 'false')
  await act(() => toggle.click())
  assert.equal(toggle.getAttribute('aria-expanded'), 'true')
  const panel = dom.document.body.querySelector<HTMLElement>('aside[aria-label="Bot details"]')

  assert.ok(panel, 'the Bot details panel opens beside the chat')
  assert.ok(buttonNamed(panel, 'Edit Bot'), 'its owner can edit the Bot')
  assert.ok(triggerQueries.length > 0)
  for (const query of triggerQueries)
    assert.deepEqual(query, ['team', 'bot'], 'queries the Bot, not its chat or the team')
  assert.ok(panel.textContent.includes('Ask here to schedule recurring work.'))
  assert.equal(
    panel.querySelector('section[aria-label="Changes"]'),
    null,
    'Bot details have no Changes',
  )
  // #3790: what the Bot may use is set here, each row opening its picker or menu.
  assert.deepEqual(accessRows(panel), [
    { text: 'Credentials0', opens: true },
    { text: 'Computers0', opens: true },
    { text: 'Full Access', opens: true },
  ])
  await act(() =>
    panel.dispatchEvent(new dom.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  )
  assert.equal(toggle.getAttribute('aria-expanded'), 'false', 'Esc closes the details')
  await act(() => toggle.click())
  assert.ok(frames.length > 0)
  // Every frame, the first one included: a frame without them is the composer jumping.
  for (const frame of frames) {
    assert.equal(frame.placeholder, 'Message Ada')
    assert.equal(frame.runtimeControl?.value?.label, 'Claude Code on a laptop')
    // Access controls must never implicitly grant a computer from an @ mention.
    assert.equal(frame.credentialSelector, undefined)
  }
  assert.ok(frames.at(-1)?.botCredentials)
  assert.equal(frames.at(-1)?.bypassControl?.active, true)
  assert.ok(frames.at(-1)?.runtimeControl?.onSettings)
  frames.at(-1)?.runtimeControl?.onSettings?.()
  assert.equal(settingsOpened, 1)
  // #3298: Bot details edit the Bot's own permission mode, the composer its model.
  assert.deepEqual(bypassQueries, ['bot'], "reads the Bot's permission mode, not its chat's")
  assert.equal(frames.at(-1)?.modelSession?.sessionId, 'bot')

  // Both composers show quota on the compact runtime line.
  const quota: RuntimeQuota = {
    runtimeId: 'runtime-1',
    provider: 'claude-code',
    fetchedAt: '2026-01-01T00:00:00.000Z',
    available: true,
    windows: [{ id: 'five_hour', label: '5-hour', usedPercent: 40, resetsAt: null }],
  }
  const quotas = new Map([['runtime-1', quota]])
  const botControl = frames.at(-1)?.runtimeControl

  assert.ok(botControl)
  const taskControl: RuntimeControl = { value: botControl.value }

  for (const [name, control] of [
    ['Bot', botControl],
    ['Task', taskControl],
  ] as const) {
    const line = dom.document.createElement('div')

    dom.document.body.append(line)
    const lineRoot = createRoot(line as unknown as HTMLElement)

    await act(() =>
      lineRoot.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(RuntimeSelector, { ...control, quotas, compact: true }),
        ),
      ),
    )
    assert.ok(line.querySelector('[role="progressbar"]'), `${name} composer shows usage`)
    await act(() => lineRoot.unmount())
  }
  await act(() => root.unmount())
  queryClient.clear()
})

test("a teammate's Bot chat shows its model locked and its access read-only", async () => {
  queryClient.setQueryData<AgentConversation[]>(queryKeys.agentSessions('team'), [
    row({
      sessionId: 'chat',
      kind: 'channel',
      title: 'Ada',
      faces: [{ id: 'bot', name: 'Ada', agent: {} }],
    }),
    row({ sessionId: 'bot', title: 'Ada', isOwner: false, runtimeId: 'runtime-1' }),
  ])
  frames.length = 0
  bypassQueries.length = 0
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
          onOpenSession: () => {},
        }),
      ),
    ),
  )
  // The details stay open from the Bot chat before, and a teammate's Bot has no Edit Bot.
  const panel = dom.document.body.querySelector<HTMLElement>('aside[aria-label="Bot details"]')

  assert.ok(panel, 'the details stay open in the next Bot chat')
  assert.match(panel.textContent, /Ada/)
  assert.equal(buttonNamed(panel, 'Edit Bot'), undefined)
  // #3790: anyone else reads what the Bot may use and its mode, with nothing to open.
  assert.deepEqual(bypassQueries, ['bot'], "reads the Bot's permission mode, not its chat's")
  assert.deepEqual(accessRows(panel), [
    { text: 'Credentials0', opens: false },
    { text: 'Computers0', opens: false },
    { text: 'Full Access', opens: false },
  ])
  assert.equal(frames.at(-1)?.modelSession?.sessionId, 'bot')
  assert.equal(frames.at(-1)?.botCredentials, undefined)
  assert.equal(frames.at(-1)?.bypassControl, undefined)
  assert.equal(frames.at(-1)?.modelSession?.lockedHint, 'Only the owner can change model settings.')
  await act(() => root.unmount())
  queryClient.clear()
})
