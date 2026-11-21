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

test("someone else's Bot with Tasks running that this viewer does not list is at work", () => {
  const shared = run('bot', idle, { tasks: { running: 1, waiting: 0 } })

  assert.deepEqual(activityOf(shared, []), { kind: 'working', run: shared })
  // A Bot still in setup that works says it works, as with listed Tasks.
  const settingUp = run('bot', idle, {
    tasks: { running: 1, waiting: 0 },
    botOnboarding: 'pending',
  })

  assert.equal(activityOf(settingUp, []).kind, 'working')
  assert.equal(activityOf(run('bot', idle, { tasks: { running: 0, waiting: 1 } }), []).kind, 'idle')
  // The owner lists the Tasks themselves, and those decide.
  assert.equal(activityOf(shared, [run('Done', idle)]).kind, 'idle')
})

test('a question from the Bot or a sub-agent outranks work', () => {
  const activity = activityOf(run('bot', turn()), [run('kid', idle, asking)])

  assert.deepEqual(activity, { kind: 'asking', question: 'Include Slack?' })
})

test('a failed run shows as an error, without its raw label', () => {
  const activity = activityOf(run('bot', { ...idle, phase: 'failed', label: 'Request failed' }), [])

  assert.deepEqual(activity, { kind: 'error' })
})

test('an onboarding question is setup, while a real approval still needs attention', () => {
  const fields = {
    botOnboarding: 'active',
    inputRequests: asking.inputRequests.map((q) => ({ ...q, category: 'preference' })),
  }

  assert.equal(activityOf(run('bot', idle, fields), []).kind, 'onboarding')
  assert.equal(
    activityOf(run('bot', idle, { ...fields, inputRequests: asking.inputRequests }), []).kind,
    'asking',
  )
  assert.equal(
    activityOf(run('bot', idle, { ...fields, botOnboarding: 'completed' }), []).kind,
    'asking',
  )
})

test('a Bot in setup shows its work while a turn runs, and its setup only at rest', () => {
  const setup = { botOnboarding: 'active' }
  const bot = run('bot', turn(), setup)

  assert.deepEqual(activityOf(bot, []), { kind: 'working', run: bot })
  const kid = run('kid', turn())

  assert.deepEqual(activityOf(run('bot', idle, setup), [kid]), { kind: 'working', run: kid })
  assert.equal(activityOf(run('bot', idle, setup), []).kind, 'onboarding')
})
