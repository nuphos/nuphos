import assert from 'node:assert/strict'
import { test } from 'node:test'

import { activityOf } from './bot-activity.ts'

import type { Run } from './bot-activity.ts'
import type { RuntimeExecution } from '../../lib/runtimeExecution.ts'

const idle: RuntimeExecution = { state: 'idle', schemaVersion: 2 }
const turn = (extra: Partial<RuntimeExecution> = {}): RuntimeExecution => ({
  state: 'active',
  schemaVersion: 2,
  phase: 'running',
  ...extra,
})
const run = (sessionId: string, runtimeState: RuntimeExecution | undefined, fields = {}): Run => ({
  conversation: {
    sessionId,
    title: sessionId,
    firstMessage: '',
    messageCount: 0,
    createdAt: '',
    lastActiveAt: '',
    ...fields,
  } as Run['conversation'],
  runtimeState,
})
const asking = {
  inputRequests: [
    {
      id: 'q',
      category: 'choice',
      question: 'Include Slack?',
      status: 'open',
      askedAt: '2026-11-10T00:00:00Z',
      toolCallId: 'q',
    },
  ],
}

test('an idle Bot with idle sub-agents is idle', () => {
  assert.deepEqual(activityOf(run('bot', idle), [run('kid', idle)]), { kind: 'idle' })
})

test("the Bot's own turn is its activity", () => {
  const bot = run('bot', turn())

  assert.equal(activityOf(bot, []).kind, 'working')
})

test('a sub-agent at work is the Bot at work, through its run', () => {
  const kid = run('Market review', turn())
  const activity = activityOf(run('bot', idle), [kid])

  assert.equal(activity.kind, 'working')
  assert.equal(activity.kind === 'working' && activity.run, kid)
})

test('a question from the Bot or a sub-agent outranks work', () => {
  const activity = activityOf(run('bot', turn()), [run('kid', idle, asking)])

  assert.deepEqual(activity, { kind: 'asking', question: 'Include Slack?' })
})

test('a failed run shows as an error', () => {
  const activity = activityOf(run('bot', { ...idle, phase: 'failed', label: 'tests failed' }), [])

  assert.deepEqual(activity, { kind: 'error', label: 'tests failed' })
})
