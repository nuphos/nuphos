import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  caretAtEdge,
  historyStep,
  IDLE_CURSOR,
  recallKey,
  retractTarget,
  sentHistory,
  withoutRetracted,
} from './composerRecall.ts'
import { rememberDispatchedDraft } from './queuedAutoSend.ts'

import type { Message, QueuedMessage } from './model.ts'

const said = (id: string, role: Message['role'], text: string, sender?: string): Message => ({
  id,
  role,
  parts: [{ type: 'text', text }],
  ...(sender
    ? {
        metadata: {
          version: 1,
          sender: { type: 'user', id: sender, displayName: sender },
          source: 'nuphos',
          sentAt: '',
        } as Message['metadata'],
      }
    : {}),
})
const queued = (id: string, extra: Partial<QueuedMessage> = {}): QueuedMessage => ({
  id,
  text: `text ${id}`,
  filePaths: [],
  ...extra,
})
const idle = { streaming: false, streamId: null, messages: [] as Message[], unsaved: false }

test('Esc takes back the newest queued message first', () => {
  const tab = { ...idle, queued: [queued('q1'), queued('q2')] }

  assert.deepEqual(retractTarget(tab), { kind: 'queued', item: tab.queued[1] })
  // One whose turn already started is in the transcript, no longer waiting.
  const started = { ...tab, messages: [said('q2', 'user', 'text q2')] }

  assert.deepEqual(retractTarget(started), { kind: 'queued', item: tab.queued[0] })
})

test('a steer already on its way is not taken back', () => {
  assert.equal(retractTarget({ ...idle, queued: [queued('s', { steering: true })] }), null)
})

test('Esc takes back a just-sent message while its turn has no output', () => {
  rememberDispatchedDraft('stream-1', { id: 'm1', text: 'deploy it', filePaths: ['/a.png'] })
  const running = { ...idle, streaming: true, streamId: 'stream-1' }
  const earlier = [said('m0', 'user', 'hi'), said('a0', 'assistant', 'hello')]

  assert.deepEqual(retractTarget({ ...running, messages: [...earlier, said('m1', 'user', 'x')] }), {
    kind: 'turn',
    draft: { id: 'm1', text: 'deploy it', filePaths: ['/a.png'] },
  })
  // An assistant message holding only bookkeeping is still no answer.
  const bookkeeping = {
    id: 'a1',
    role: 'assistant',
    parts: [{ type: 'text', text: ' ' }, { type: 'step-start' }],
  } as Message

  assert.equal(
    retractTarget({ ...running, messages: [said('m1', 'user', 'x'), bookkeeping] })?.kind,
    'turn',
  )
})

test('once the agent has output, Esc no longer takes the message back', () => {
  rememberDispatchedDraft('stream-2', { id: 'm1', text: 'x', filePaths: [] })
  const running = { ...idle, streaming: true, streamId: 'stream-2' }
  const tool = { id: 'a1', role: 'assistant', parts: [{ type: 'tool-bash' }] } as Message

  for (const answer of [said('a1', 'assistant', 'On it'), tool])
    assert.equal(retractTarget({ ...running, messages: [said('m1', 'user', 'x'), answer] }), null)
  // Finished, or a turn this client did not send: nothing to take back.
  assert.equal(
    retractTarget({ ...running, streaming: false, messages: [said('m1', 'user', 'x')] }),
    null,
  )
  assert.equal(
    retractTarget({ ...running, streamId: 'other', messages: [said('m1', 'user', 'x')] }),
    null,
  )
})

test('a plan approval is never taken back', () => {
  rememberDispatchedDraft('stream-3', {
    id: 'm1',
    text: 'ok',
    filePaths: [],
    turnKind: 'plan-approval',
  })
  assert.equal(
    retractTarget({
      ...idle,
      streaming: true,
      streamId: 'stream-3',
      messages: [said('m1', 'user', 'ok')],
    }),
    null,
  )
})

test('history holds only your own typed messages, oldest first', () => {
  const messages = [
    said('1', 'user', 'first', 'me'),
    said('2', 'assistant', 'answer'),
    said('3', 'user', 'from a teammate', 'bob'),
    { ...said('4', 'user', 'Approved plan #1', 'me'), turnKind: 'plan-approval' as const },
    said('5', 'user', 'second', 'me'),
  ]

  assert.deepEqual(sentHistory(messages, 'me', false), ['first', 'second'])
  // A message without a sender predates attribution and is the owner's.
  assert.deepEqual(sentHistory([said('1', 'user', 'old')], 'me', false), ['old'])
  assert.deepEqual(sentHistory([said('1', 'user', 'old')], 'me', true), [])
})

test('Up walks back, Down walks forward, and past the newest restores the draft', () => {
  const history = ['one', 'two', 'three']
  let cursor = IDLE_CURSOR
  const press = (direction: 'up' | 'down', current = '') => {
    const step = historyStep(cursor, direction, history, current)

    if (step) cursor = step.cursor

    return step?.text ?? null
  }

  assert.equal(press('down', 'my draft'), null)
  assert.equal(press('up', 'my draft'), 'three')
  assert.equal(press('up'), 'two')
  assert.equal(press('up'), 'one')
  assert.equal(press('up'), null)
  assert.equal(press('down'), 'two')
  assert.equal(press('down'), 'three')
  assert.equal(press('down'), 'my draft')
  assert.deepEqual(cursor, IDLE_CURSOR)
  assert.equal(historyStep(IDLE_CURSOR, 'up', [], ''), null)
})

test('arrows recall only from the first (Up) or last (Down) line', () => {
  assert.equal(caretAtEdge('', '', 'up'), true)
  assert.equal(caretAtEdge('', '', 'down'), true)
  assert.equal(caretAtEdge('line one', '\nline two', 'up'), true)
  assert.equal(caretAtEdge('line one', '\nline two', 'down'), false)
  assert.equal(caretAtEdge('line one\nline', ' two', 'up'), false)
  assert.equal(caretAtEdge('line one\nline', ' two', 'down'), true)
})

test('keys during IME composition or with a modifier never recall', () => {
  assert.equal(recallKey({ key: 'Escape', composing: false, modified: false }), 'retract')
  assert.equal(recallKey({ key: 'ArrowUp', composing: false, modified: false }), 'up')
  assert.equal(recallKey({ key: 'ArrowDown', composing: false, modified: false }), 'down')
  for (const key of ['Escape', 'ArrowUp', 'ArrowDown']) {
    assert.equal(recallKey({ key, composing: true, modified: false }), null)
    assert.equal(recallKey({ key, composing: false, modified: true }), null)
  }
  assert.equal(recallKey({ key: 'Enter', composing: false, modified: false }), null)
})

test('a taken-back message leaves the transcript with the empty turn after it', () => {
  const messages = [said('m0', 'user', 'hi'), said('m1', 'user', 'x'), said('a1', 'assistant', '')]

  assert.deepEqual(withoutRetracted({ messages }, 'm1').messages, [messages[0]])
  assert.deepEqual(withoutRetracted({ messages }, 'gone').messages, messages)
})
