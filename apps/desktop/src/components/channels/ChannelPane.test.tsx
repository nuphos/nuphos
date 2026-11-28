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
const renames: unknown[][] = []
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
        if (key === 'agentRenameConversation') {
          renames.push(args)

          return Promise.resolve({ title: args[1] })
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
  // A chat's new name is announced on the window, which takes only its own events.
  CustomEvent: dom.CustomEvent,
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
// A Bot details section: each row's text, and whether it opens anything.
const sectionRows = (panel: Element, title = 'Access') => {
  const section = panel.querySelector(`section[aria-label="${title}"]`)

  assert.ok(section, `Bot details has a ${title} section`)

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
  // Its instructions and Triggers are edited in Edit Bot, so the details list neither.
  assert.equal(triggerQueries.length, 0)
  assert.ok(!panel.textContent.includes('Triggers'))
  assert.equal(
    panel.querySelector('section[aria-label="Changes"]'),
    null,
    'Bot details have no Changes',
  )
  // #3790: what the Bot may use is set here, each row opening its picker or menu.
  assert.deepEqual(sectionRows(panel), [
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
    // #4323 undone: the composer only reports on the Bot's agent; Bot details pick it and its model.
    assert.equal(frame.runtimeControl?.statusOnly, true)
    assert.equal(frame.modelSession, undefined)
    // #3790: the Bot's credentials, computers and mode left its chat's composer for Bot details.
    assert.equal(frame.credentialSelector, undefined)
    assert.equal(frame.bypassControl, undefined)
  }
  assert.ok(frames.at(-1)?.runtimeControl?.onSettings)
  frames.at(-1)?.runtimeControl?.onSettings?.()
  assert.equal(settingsOpened, 1)
  // #3298: Bot details edit the Bot's own permission mode, the composer its model.
  assert.deepEqual(bypassQueries, ['bot'], "reads the Bot's permission mode, not its chat's")
  assert.deepEqual(sectionRows(panel, 'Runtime'), [
    { text: 'RuntimeClaude Code on a laptop', opens: true },
  ])

  // The Bot's runtime line is the Task's: a runtime with quota data shows its usage in both.
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
          createElement(RuntimeSelector, { ...control, quotas }),
        ),
      ),
    )
    assert.ok(line.querySelector('[role="progressbar"]'), `${name} composer shows usage`)
    await act(() => lineRoot.unmount())
  }
  await act(() => root.unmount())
  queryClient.clear()
})

test("a teammate's Bot chat shows its runtime and access read-only", async () => {
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
  assert.deepEqual(sectionRows(panel), [
    { text: 'Credentials0', opens: false },
    { text: 'Computers0', opens: false },
    { text: 'Full Access', opens: false },
  ])
  assert.deepEqual(sectionRows(panel, 'Runtime'), [{ text: 'Runtime', opens: false }])
  assert.equal(frames.at(-1)?.runtimeControl, undefined)
  assert.equal(frames.at(-1)?.modelSession, undefined)
  await act(() => root.unmount())
  queryClient.clear()
})

// #3009: a group chat's name in its header renames it in place, for the chat's owner only.
test("a group chat's owner renames it from its header", async () => {
  const group = (isOwner: boolean) =>
    queryClient.setQueryData(queryKeys.channel('team', 'group'), {
      detail: {
        sessionId: 'group',
        kind: 'channel',
        group: true,
        title: 'Launch room',
        isOwner,
        faces: [
          { id: 'richard', name: 'Richard' },
          { id: 'gilfoyle', name: 'Gilfoyle' },
        ],
        messages: [],
      },
      agents: [],
      revision: '1',
    })
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  const render = () =>
    act(() =>
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(ChannelPane, {
            teamId: 'team',
            channelId: 'group',
            user: { id: 'me', name: 'Me' } as UserInfo,
            dockOpen: false,
            onOpenSession: () => {},
          }),
        ),
      ),
    )

  queryClient.setQueryData<AgentConversation[]>(queryKeys.agentSessions('team'), [
    row({ sessionId: 'group', kind: 'channel', title: 'Launch room' }),
  ])
  group(false)
  await render()
  assert.ok(container.textContent.includes('Launch room'))
  assert.equal(buttonNamed(container, 'Rename chat: Launch room'), undefined, 'a member reads it')

  group(true)
  await render()
  const rename = buttonNamed(container, 'Rename chat: Launch room')

  assert.ok(rename, 'its owner renames it from the header')
  await act(() => rename.click())
  const input = dom.document.body.querySelector<HTMLInputElement>('input[aria-label="Name"]')

  assert.ok(input, 'a rename dialog opens')
  assert.ok(dom.document.body.textContent.includes('Rename chat'))
  await act(() => {
    Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, 'value')?.set?.call(
      input,
      'Q4 launch',
    )
    input.dispatchEvent(new dom.Event('input', { bubbles: true }))
  })
  await act(async () => {
    input.form?.requestSubmit()
    await new Promise((resolve) => setTimeout(resolve, 400))
  })
  assert.deepEqual(renames, [['group', 'Q4 launch', 'team']])
  assert.notEqual(
    queryClient.getQueryState(queryKeys.channel('team', 'group'))?.fetchStatus,
    'idle',
    'the chat is read again for its new name',
  )
  assert.equal(
    dom.document.body.querySelector('input[aria-label="Name"]'),
    null,
    'the dialog closes once saved',
  )
  await act(() => root.unmount())
  queryClient.clear()
})
