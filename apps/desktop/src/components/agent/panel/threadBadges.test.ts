import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  knownThreadTitle,
  rememberThreadTitle,
  threadBadgeInfo,
  threadRuntimeName,
} from './threadBadges.ts'

import type { ToolPart } from './parts.ts'

const ID = 'c70aa4b9-a478-4eb5-bcf7-b24d62d017b4'
const part = (toolName: string, extra: Partial<ToolPart>): ToolPart => ({
  type: 'tool',
  toolCallId: 'call',
  toolName,
  state: 'output-available',
  ...extra,
})

test('a started thread takes its id from the receipt in any shape', () => {
  const input = { title: 'Sidebar cleanup', prompt: 'Go' }
  const json = JSON.stringify({ status: 'started', threadId: ID })

  for (const output of [{ threadId: ID }, json, [{ type: 'text', text: json }]]) {
    assert.deepEqual(threadBadgeInfo(part('create_thread', { input, output })), {
      threadId: ID,
      title: 'Sidebar cleanup',
      verb: 'started',
      pending: false,
      model: null,
      effort: null,
      modelReason: null,
    })
  }
})

test('a started thread shows the model the agent chose for it, and why', () => {
  const input = {
    title: 'Rename strings',
    prompt: 'Go',
    model: 'claude-haiku-5-5',
    effort: 'low',
    modelReason: 'Mechanical edits across a few files.',
  }
  const info = threadBadgeInfo(part('create_thread', { input, output: { threadId: ID } }))

  assert.equal(info?.model, 'claude-haiku-5-5')
  assert.equal(info?.effort, 'low')
  assert.equal(info?.modelReason, 'Mechanical edits across a few files.')
  // A message to a thread changes no model, so it shows none.
  const sent = threadBadgeInfo(
    part('send_message_to_thread', { input: { threadId: ID, model: 'x' } }),
  )

  assert.equal(sent?.model, null)
})

test('a messaged thread takes its id from the input', () => {
  const info = threadBadgeInfo(part('send_message_to_thread', { input: { threadId: ID } }))

  assert.equal(info?.threadId, ID)
  assert.equal(info?.verb, 'messaged')
})

test('a call in flight shows before its receipt arrives', () => {
  const info = threadBadgeInfo(
    part('create_thread', { state: 'input-available', input: { title: 'Audit' } }),
  )

  assert.equal(info?.pending, true)
  assert.equal(info?.threadId, null)
})

test('failed calls, missing receipts and other tools stay tool rows', () => {
  assert.equal(threadBadgeInfo(part('create_thread', { state: 'output-error' })), null)
  assert.equal(threadBadgeInfo(part('create_thread', { input: { title: 'x' } })), null)
  assert.equal(threadBadgeInfo(part('archive_thread', { input: { threadId: ID } })), null)
  assert.equal(
    threadBadgeInfo(part('send_message_to_thread', { input: { threadId: 'nope' } })),
    null,
  )
})

test('a thread title seen earlier names a later badge for the same thread', () => {
  rememberThreadTitle(ID, 'Sidebar cleanup')
  rememberThreadTitle('other', null)

  assert.equal(knownThreadTitle(ID), 'Sidebar cleanup')
  assert.equal(knownThreadTitle('0b8d7c6e-1111-4222-8333-944455556666'), null)
  assert.equal(knownThreadTitle(null), null)
})

test('a thread names the computer and agent it runs on, once each', () => {
  assert.equal(threadRuntimeName('claude-code', "Zeabur's Box"), "Zeabur's Box · Claude Code")
  assert.equal(threadRuntimeName('codex', 'Codex in MacBook M5'), 'Codex in MacBook M5')
  assert.equal(threadRuntimeName('codex', undefined), 'Codex')
  assert.equal(threadRuntimeName(undefined, undefined), null)
})
