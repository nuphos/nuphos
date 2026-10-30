import assert from 'node:assert/strict'
import { before, mock, test } from 'node:test'

import type { Message, Tab } from './model.ts'

let steer: () => Promise<{ messageId: string; text: string }>
let sendSteering: (tabId: string, text: string) => Promise<void>
const tabsRef: { current: Tab[] } = { current: [] }
const setTabs = (next: Tab[] | ((tabs: Tab[]) => Tab[])) => {
  tabsRef.current = typeof next === 'function' ? next(tabsRef.current) : next
}

before(async () => {
  mock.module('react', {
    namedExports: { useCallback: (fn: unknown) => fn, createContext: () => ({}) },
  })
  mock.module('../../../api.ts', {
    namedExports: { api: { agentSteerConversation: () => steer() } },
  })
  mock.module('../../../api/errors.ts', { namedExports: { parseAtlasError: () => ({}) } })
  mock.module('../../../i18n/index.ts', { namedExports: { t: (text: string) => text } })
  mock.module('../../ui/toast.ts', { namedExports: { toast: { apiError: () => undefined } } })
  const { useSteering } = await import('./useSteering.ts')

  sendSteering = useSteering({
    tabsRef,
    setTabs,
    teamId: 'team',
    currentUser: null,
    fallback: async () => assert.fail('a delivered steer must not fall back to a message'),
  } as unknown as Parameters<typeof useSteering>[0])
})

const user = (id: string): Message => ({ id, role: 'user', parts: [{ type: 'text', text: id }] })
const assistant = (id: string): Message => ({ id, role: 'assistant', parts: [] })
const tab = (streamId: string, messages: Message[]) =>
  ({ id: 'tab', sessionId: 'session', streamId, messages, queued: [] }) as unknown as Tab

const current = () => tabsRef.current[0] as Tab

// The transcript text the user sees, receipts included.
const shown = (t: Tab) =>
  t.messages.flatMap((message) =>
    message.parts.flatMap((part) =>
      part.type === 'data-steering' ? [part.data.text] : part.type === 'text' ? [part.text] : [],
    ),
  )

async function steerWhile(change: (t: Tab) => Tab) {
  let deliver!: () => void

  steer = () =>
    new Promise((resolve) => {
      deliver = () => resolve({ messageId: 'steer-1', text: 'also check the logs' })
    })
  const sent = sendSteering('tab', 'also check the logs')

  await Promise.resolve()
  setTabs((tabs) => tabs.map(change))
  deliver()
  await sent
}

test('a steer stays visible when the turn adds an assistant message while it is in flight', async () => {
  tabsRef.current = [tab('stream-1', [user('first'), assistant('a1')])]
  await steerWhile((t) => ({ ...t, messages: [...t.messages, assistant('a2')] }))

  assert.ok(shown(current()).includes('also check the logs'))
  assert.deepEqual(current().queued, [])
})

test('a steer stays visible when the stream is resumed while it is in flight', async () => {
  tabsRef.current = [tab('stream-1', [user('first'), assistant('a1')])]
  await steerWhile((t) => ({ ...t, streamId: 'stream-2' }))

  assert.ok(shown(current()).includes('also check the logs'))
  assert.deepEqual(current().queued, [])
})
