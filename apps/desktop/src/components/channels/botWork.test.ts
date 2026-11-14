import assert from 'node:assert/strict'
import { test } from 'node:test'

import { botWorkOf, runStartedAt, stepOf, workSince } from './botWork.ts'

import type { RuntimeExecution } from '../../lib/runtimeExecution.ts'
import type { Run } from '../sidebar/bot-activity.ts'

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

test('a resting Bot and a failed one show nothing', () => {
  assert.equal(botWorkOf(run('bot', idle), [run('kid', idle)], 'c'), null)
  assert.equal(
    botWorkOf(run('bot', { state: 'idle', schemaVersion: 2, phase: 'failed' }), [], 'c'),
    null,
  )
  assert.equal(botWorkOf(undefined, [], 'c'), null)
})

test("a turn this chat started is the chat's; one from a sub-agent's report says so", () => {
  const kid = run('Preview', idle)
  const chat = botWorkOf(run('bot', turn({ channelIds: ['c'] })), [kid], 'c')

  assert.equal(chat?.kind, 'turn')
  assert.equal(chat?.kind === 'turn' && chat.reason, 'chat')
  const report = botWorkOf(
    run('bot', turn(), { lastMessage: { text: 'done', from: 'Preview' } }),
    [kid],
    'c',
  )

  assert.equal(report?.kind === 'turn' && report.reason, 'report')
  // Woken by anything else, a schedule say, or a turn about another chat.
  const other = botWorkOf(run('bot', turn({ channelIds: ['elsewhere'] })), [kid], 'c')

  assert.equal(other?.kind === 'turn' && other.reason, 'other')
})

test('a running shell command outranks a tool, which outranks thinking', () => {
  const state = turn({
    tools: [
      { id: '1', status: 'running', title: 'Read file' },
      { id: '2', terminal: { terminalId: 't', command: 'pnpm  build\n', status: 'running' } },
    ],
  })

  assert.deepEqual(stepOf(state), { kind: 'command', command: 'pnpm build' })
  assert.deepEqual(stepOf(turn({ tools: [{ id: '1', status: 'running', title: 'Read file' }] })), {
    kind: 'tool',
    title: 'Read file',
  })
  assert.deepEqual(stepOf(turn({ tools: [{ id: '1', status: 'completed', title: 'x' }] })), {
    kind: 'thinking',
  })
  assert.deepEqual(stepOf(undefined), { kind: 'thinking' })
})

test('a Bot whose turn ended while its sub-agents work waits on them', () => {
  const busy = run('Preview', turn())
  const background = run('Docs', { ...idle, phase: 'background_tools' })
  const work = botWorkOf(run('bot', idle), [busy, run('Done', idle), background], 'c')

  assert.equal(work?.kind, 'waiting')
  assert.deepEqual(
    work?.kids.map((kid) => kid.conversation.sessionId),
    ['Preview', 'Docs'],
  )
})

test("the Bot's own background work, with no sub-agent at it, is background", () => {
  const work = botWorkOf(run('bot', { ...idle, phase: 'background_tools' }), [], 'c')

  assert.equal(work?.kind, 'background')
})

test('a question from the Bot or a sub-agent is asking', () => {
  const asking = {
    inputRequests: [
      { id: 'q', category: 'x', question: 'Which region?', status: 'open', askedAt: '' },
    ],
  }
  const work = botWorkOf(run('bot', idle), [run('kid', turn(), asking)], 'c')

  assert.equal(work?.kind, 'asking')
  assert.equal(work?.kind === 'asking' && work.question, 'Which region?')
})

test("a run's start reads both list formats and nothing else", () => {
  const started = (startedAt: string | null) =>
    runStartedAt(run('bot', turn(), { activeRun: { streamId: 's', startedAt } }))

  assert.equal(started('2026-11-13T12:00:00.000Z'), Date.parse('2026-11-13T12:00:00.000Z'))
  // The shared run store keeps epoch milliseconds, which Date.parse cannot read.
  assert.equal(started('1763035200000'), 1763035200000)
  assert.equal(started(null), undefined)
  assert.equal(started('soon'), undefined)
  assert.equal(runStartedAt(run('bot', turn())), undefined)
})

test("the Bot's own turn counts from its run, and shows no time without one", () => {
  const bot = run('bot', turn({ channelIds: ['c'] }), {
    activeRun: { streamId: 's', startedAt: '1000' },
  })

  assert.equal(workSince(botWorkOf(bot, [], 'c'), bot, []), 1000)
  const unknown = run('bot', turn({ channelIds: ['c'] }))

  assert.equal(workSince(botWorkOf(unknown, [], 'c'), unknown, []), undefined)
})

test('waiting counts from the earliest sub-agent that says when it started', () => {
  const kids = [
    run('a', turn(), { activeRun: { streamId: 'a', startedAt: '5000' } }),
    run('b', turn(), { activeRun: { streamId: 'b', startedAt: '3000' } }),
    run('c', turn()),
  ]
  const bot = run('bot', idle)

  assert.equal(workSince(botWorkOf(bot, kids, 'c'), bot, kids), 3000)
  assert.equal(workSince(botWorkOf(bot, [run('c', turn())], 'c'), bot, []), undefined)
})

test('a question counts from when it was asked; background work has no start', () => {
  const kid = run('kid', turn(), {
    inputRequests: [
      { id: 'q', category: 'x', question: 'Q?', status: 'open', askedAt: '2026-11-13T12:00:00Z' },
    ],
  })
  const bot = run('bot', idle)

  assert.equal(
    workSince(botWorkOf(bot, [kid], 'c'), bot, [kid]),
    Date.parse('2026-11-13T12:00:00Z'),
  )
  const busy = run('bot', { ...idle, phase: 'background_tools' })

  assert.equal(workSince(botWorkOf(busy, [], 'c'), busy, []), undefined)
  assert.equal(workSince(null, bot, []), undefined)
})
