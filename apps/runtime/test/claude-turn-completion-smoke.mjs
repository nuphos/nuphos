/* eslint-disable sonarjs/no-internal-api-use -- Regression tests exercise the exact pinned adapter bundle patched in the runtime image. */
/* eslint-disable require-atomic-updates -- Each test owns its isolated session and controls the SDK stream. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { ClaudeAcpAgent } from '../image/claude-agent-acp/node_modules/@agentclientprotocol/claude-agent-acp/dist/acp-agent.js'
import { Pushable } from '../image/claude-agent-acp/node_modules/@agentclientprotocol/claude-agent-acp/dist/utils.js'

const tick = () => new Promise((resolve) => setImmediate(resolve))

async function until(predicate) {
  for (let n = 0; n < 100; n++) {
    if (predicate()) return
    await tick()
  }
  assert.ok(predicate(), 'adapter did not reach expected state')
}
const result = (uuid, overrides = {}) => ({
  type: 'result',
  subtype: 'success',
  stop_reason: 'end_turn',
  is_error: false,
  result: '',
  errors: [],
  duration_ms: 0,
  duration_api_ms: 0,
  num_turns: 1,
  total_cost_usd: 0,
  usage: {
    input_tokens: 10,
    output_tokens: 5,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  },
  modelUsage: {},
  permission_denials: [],
  uuid: randomUUID(),
  session_id: 'test-session',
  user_message_uuid: uuid,
  origin: { kind: 'human' },
  ...overrides,
})
const idle = { type: 'system', subtype: 'session_state_changed', state: 'idle' }

function harness(t, owedTrailingIdles = 0) {
  const updates = [],
    errors = [],
    settled = []
  const agent = new ClaudeAcpAgent(
    {
      sessionUpdate: async (u) => {
        updates.push(u)
      },
    },
    { log: () => {}, error: (e) => errors.push(String(e)) },
  )
  const input = new Pushable(),
    output = new Pushable()
  const turn = {
    promptUuid: 'original',
    settled: false,
    resolve: (r) => settled.push(r),
    reject: (e) => settled.push(e),
  }
  const session = {
    cancelled: false,
    cwd: '/test',
    titles: { onTurnEnd: async () => {}, onAssistantText: () => {} },
    modes: { currentModeId: 'default', availableModes: [] },
    models: { currentModelId: 'default', availableModels: [] },
    modelInfos: [],
    settingsManager: { dispose() {}, getSettings: () => ({}) },
    accumulatedUsage: {
      inputTokens: 0,
      outputTokens: 0,
      cachedReadTokens: 0,
      cachedWriteTokens: 0,
    },
    accumulatedModelUsage: {},
    lastModelUsageReading: {},
    configOptions: [],
    abortController: new AbortController(),
    cancelController: new AbortController(),
    contextWindowSize: 200000,
    taskState: new Map(),
    toolUseCache: {},
    emittedToolCalls: new Set(),
    liveBackgroundTasks: new Map(),
    owedTrailingIdles,
    messageIdToUuid: new Map(),
    sessionFailureState: { epoch: randomUUID(), revisions: new Map(), active: new Map() },
    fileChangeReportRequestIds: new Set(),
    turnQueue: [turn],
    activeTurn: turn,
    input,
    query: Object.assign(output[Symbol.asyncIterator](), { close() {}, interrupt: async () => {} }),
  }

  agent.sessions['test-session'] = session
  const consumer = agent.runConsumer(session, { sessionId: 'test-session' })

  t.after(async () => {
    output.end()
    await consumer
    assert.deepEqual(errors, [])
  })

  return {
    agent,
    session,
    turn,
    settled,
    updates,
    output,
    async steer() {
      assert.deepEqual(
        await agent.steer({ sessionId: 'test-session', prompt: [{ type: 'text', text: 'steer' }] }),
        { outcome: 'injected' },
      )

      return (await input[Symbol.asyncIterator]().next()).value.uuid
    },
    async emit(message) {
      output.push(message)
      await tick()
      await tick()
    },
  }
}

test('a stamped steer result completes despite stale idle debt and no replayed echo', async (t) => {
  const h = harness(t, 3),
    id = await h.steer()

  await h.emit(result(id))
  await until(() => h.settled.length === 1)
  assert.equal(h.settled[0].stopReason, 'end_turn')
  assert.equal(h.settled[0].usage.inputTokens, 10)
  assert.equal(h.session.activeTurn, null)
  await h.emit(idle)
  assert.equal(h.settled.length, 1)
})

test('interrupted and older steer results cannot finish the latest steer', async (t) => {
  const h = harness(t),
    first = await h.steer(),
    latest = await h.steer()

  await h.emit(result('original', { stop_reason: 'tool_use' }))
  await h.emit(result(first))
  assert.equal(h.settled.length, 0)
  await h.emit(result(latest))
  await until(() => h.settled.length === 1)
  assert.equal(h.settled[0].usage.inputTokens, 30)
})

test('autonomous results with a matching stamp do not settle a user turn', async (t) => {
  const h = harness(t),
    id = await h.steer()

  await h.emit(result(id, { origin: { kind: 'task-notification' } }))
  assert.equal(h.settled.length, 0)
  await h.emit(result(id))
  await until(() => h.settled.length === 1)
})

test('legacy unstamped results still await the replayed steer echo and idle', async (t) => {
  const h = harness(t),
    id = await h.steer()

  await h.emit({
    type: 'user',
    uuid: id,
    isReplay: true,
    message: { role: 'user', content: [] },
    parent_tool_use_id: null,
  })
  await h.emit(result())
  assert.equal(h.settled.length, 0)
  await h.emit(idle)
  await until(() => h.settled.length === 1)
})

test('matching results retain the native background-subagent hold', async (t) => {
  const h = harness(t),
    id = await h.steer()

  h.turn.spawnedTaskIds = new Set(['task'])
  h.session.liveBackgroundTasks.set('task', { isSubagent: true })
  await h.emit(result(id))
  assert.equal(h.settled.length, 0)
  assert.equal(h.turn.deferredSettle.stopReason, 'end_turn')
  h.session.liveBackgroundTasks.delete('task')
  await h.emit(idle)
  await until(() => h.settled.length === 1)
})

test('the completed steer trailing idle does not fail the next active turn', async (t) => {
  const h = harness(t),
    id = await h.steer()

  await h.emit(result(id))
  await until(() => h.settled.length === 1)
  const next = {
    promptUuid: 'next',
    settled: false,
    resolve: () => assert.fail('next turn ended early'),
    reject: () => assert.fail('next turn failed early'),
  }

  h.session.activeTurn = next
  h.session.turnQueue = [next]
  await h.emit(idle)
  assert.equal(next.settled, false)
  h.session.activeTurn = null
  h.session.turnQueue = []
})

test('matching steer result preserves max-token termination rather than inventing success', async (t) => {
  const h = harness(t),
    id = await h.steer()

  await h.emit(result(id, { stop_reason: 'max_tokens' }))
  await until(() => h.settled.length === 1)
  assert.equal(h.settled[0].stopReason, 'max_tokens')
})

test('a newer steer arriving while a matched result is being published retains ownership', async (t) => {
  const h = harness(t),
    first = await h.steer()

  await h.emit({
    type: 'assistant',
    uuid: randomUUID(),
    parent_tool_use_id: null,
    message: {
      role: 'assistant',
      model: 'test-model',
      usage: result(first).usage,
      content: [{ type: 'text', text: 'answer' }],
      stop_reason: 'end_turn',
    },
  })
  let latest

  h.agent.client.sessionUpdate = async ({ update }) => {
    if (update.sessionUpdate === 'usage_update' && update.cost && !latest) latest = await h.steer()
  }
  await h.emit(result(first))
  assert.ok(latest)
  assert.equal(h.settled.length, 0)
  await h.emit(result(latest))
  await until(() => h.settled.length === 1)
})
