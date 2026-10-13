/* eslint-disable sonarjs/no-internal-api-use -- Regression tests exercise the exact pinned adapter bundle patched in the runtime image. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { ClaudeAcpAgent } from '../image/claude-agent-acp/node_modules/@agentclientprotocol/claude-agent-acp/dist/acp-agent.js'
import { Pushable } from '../image/claude-agent-acp/node_modules/@agentclientprotocol/claude-agent-acp/dist/utils.js'

const SESSION = 'state-session'
const tick = () => new Promise((resolve) => setImmediate(resolve))

async function until(predicate, message = 'adapter did not reach expected state') {
  for (let n = 0; n < 200; n++) {
    if (predicate()) return
    await tick()
  }
  assert.ok(predicate(), message)
}

const usage = {
  input_tokens: 10,
  output_tokens: 5,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
}
const result = (uuid) => ({
  type: 'result',
  subtype: 'success',
  stop_reason: 'end_turn',
  is_error: false,
  result: 'done',
  errors: [],
  duration_ms: 0,
  duration_api_ms: 0,
  num_turns: 1,
  total_cost_usd: 0,
  usage,
  modelUsage: {},
  permission_denials: [],
  uuid: randomUUID(),
  session_id: SESSION,
  user_message_uuid: uuid,
  origin: { kind: 'human' },
})
const state = (value) => ({ type: 'system', subtype: 'session_state_changed', state: value })
const echo = (uuid) => ({
  type: 'user',
  uuid,
  isReplay: true,
  message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
  parent_tool_use_id: null,
  session_id: SESSION,
})

// An SDK query stream the test drives message by message, and can fail.
function sdkStream() {
  const queued = [],
    waiting = []
  const deliver = (item) => {
    const next = waiting.shift()
    if (next) item.error ? next.reject(item.error) : next.resolve(item.value)
    else queued.push(item)
  }
  return {
    next() {
      const item = queued.shift()
      if (item) return item.error ? Promise.reject(item.error) : Promise.resolve(item.value)
      return new Promise((resolve, reject) => waiting.push({ resolve, reject }))
    },
    push: (message) => deliver({ value: { value: message, done: false } }),
    fail: (error) => deliver({ error }),
    end: () => deliver({ value: { value: undefined, done: true } }),
    close() {},
    interrupt: async () => {},
  }
}

function newSession(query) {
  return {
    cancelled: false,
    cwd: '/test',
    titles: { onTurnEnd: async () => {}, onAssistantText: () => {}, onPrompt: () => {} },
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
    owedTrailingIdles: 0,
    messageIdToUuid: new Map(),
    sessionFailureState: { epoch: randomUUID(), revisions: new Map(), active: new Map() },
    fileChangeReportRequestIds: new Set(),
    turnQueue: [],
    activeTurn: null,
    input: new Pushable(),
    query,
  }
}

function harness(t) {
  const updates = [],
    errors = []
  const agent = new ClaudeAcpAgent(
    { sessionUpdate: async (notification) => void updates.push(notification) },
    { log: () => {}, error: (...args) => errors.push(args.map(String).join(' ')) },
  )
  const query = sdkStream()
  const session = newSession(query)
  const inputs = session.input[Symbol.asyncIterator]()

  agent.sessions[SESSION] = session
  session.consumer = agent.runConsumer(session, { sessionId: SESSION })
  t.after(async () => {
    if (!session.queryClosed) query.end()
    await session.consumer
  })

  const states = () =>
    updates
      .map(({ update }) => update._meta?.['ai.nuphos/sessionState']?.state)
      .filter((value) => value !== undefined)

  return {
    agent,
    session,
    query,
    errors,
    updates,
    states,
    lastState: () => states().at(-1),
    async prompt() {
      const response = agent.prompt({ sessionId: SESSION, prompt: [{ type: 'text', text: 'hi' }] })
      const { uuid } = (await inputs.next()).value

      return { response, uuid }
    },
    async emit(message) {
      query.push(message)
      await tick()
      await tick()
    },
  }
}

test('a turn held for subagents and cancelled after the SDK went idle publishes idle', async (t) => {
  const h = harness(t),
    { response, uuid } = await h.prompt()

  await h.emit(state('running'))
  await h.emit(echo(uuid))
  h.session.activeTurn.spawnedTaskIds = new Set(['task'])
  h.session.liveBackgroundTasks.set('task', { isSubagent: true })
  await h.emit(result(uuid))
  await h.emit(state('idle'))
  assert.equal(h.lastState(), 'active')

  await h.agent.cancel({ sessionId: SESSION })
  assert.equal((await response).stopReason, 'cancelled')
  await until(() => h.lastState() === 'idle', `stuck at ${h.lastState()}`)
})

test('a force-cancelled turn on a wedged query publishes idle', async (t) => {
  const h = harness(t),
    { response, uuid } = await h.prompt()

  h.agent.forceCancelGraceMs = 0
  await h.emit(state('running'))
  await h.emit(echo(uuid))
  assert.equal(h.lastState(), 'active')

  await h.agent.cancel({ sessionId: SESSION })
  assert.equal((await response).stopReason, 'cancelled')
  await until(() => h.lastState() === 'idle', `stuck at ${h.lastState()}`)
  assert.ok(h.errors.some((line) => line.includes('cancel floor elapsed')))

  await h.emit(state('running'))
  assert.equal(h.lastState(), 'active')
})

test('a completed turn stays active until the SDK trailing idle', async (t) => {
  const h = harness(t),
    { response, uuid } = await h.prompt()

  await h.emit(state('running'))
  await h.emit(echo(uuid))
  await h.emit(result(uuid))
  assert.equal((await response).stopReason, 'end_turn')
  await tick()
  assert.equal(h.lastState(), 'active')
  await h.emit(state('idle'))
  assert.equal(h.lastState(), 'idle')
})

test('a prompt the SDK has not picked up yet is active through an earlier idle', async (t) => {
  const h = harness(t),
    { response, uuid } = await h.prompt()

  await h.emit(state('idle'))
  assert.equal(h.lastState(), 'active')
  await h.emit(state('running'))
  await h.emit(echo(uuid))
  await h.emit(result(uuid))
  await h.emit(state('idle'))
  await response
  assert.equal(h.lastState(), 'idle')
})

test('an SDK stream error settles the prompt and publishes interrupted', async (t) => {
  const h = harness(t),
    { response, uuid } = await h.prompt()

  await h.emit(state('running'))
  await h.emit(echo(uuid))
  h.query.fail(new Error('stream broke'))
  await assert.rejects(response)
  await until(() => h.lastState() === 'interrupted', `stuck at ${h.lastState()}`)
  assert.equal(h.states().includes('idle'), false)
})

test('an SDK stream end mid-turn settles the prompt and publishes interrupted', async (t) => {
  const h = harness(t),
    { response, uuid } = await h.prompt()

  await h.emit(state('running'))
  await h.emit(echo(uuid))
  h.query.end()
  await response.catch(() => {})
  await until(() => h.lastState() === 'interrupted', `stuck at ${h.lastState()}`)
})

test('loading a session publishes its current state and restores no turn', async () => {
  const updates = []
  const agent = new ClaudeAcpAgent(
    { sessionUpdate: async (notification) => void updates.push(notification) },
    { log: () => {}, error: () => {} },
  )

  agent.getOrCreateSession = async ({ sessionId }) => {
    agent.sessions[sessionId] = newSession(sdkStream())
    return { sessionId }
  }
  agent.replaySessionHistory = async () => {}
  agent.sendAvailableCommandsUpdate = async () => {}
  for (const method of ['loadSession', 'resumeSession']) {
    updates.length = 0
    await agent[method]({ sessionId: SESSION, cwd: '/test', mcpServers: [] })
    assert.deepEqual(
      updates.map(({ update }) => update._meta?.['ai.nuphos/sessionState']?.state),
      ['idle'],
      method,
    )
    assert.equal(agent.sessions[SESSION].activeTurn, null)
  }
  await tick()
})

test('a prompt suggestion after the turn is forwarded as session info', async (t) => {
  const h = harness(t),
    { response, uuid } = await h.prompt()

  await h.emit(state('running'))
  await h.emit(echo(uuid))
  await h.emit(result(uuid))
  await h.emit(state('idle'))
  assert.equal((await response).stopReason, 'end_turn')

  await h.emit({
    type: 'prompt_suggestion',
    suggestion: 'run the tests',
    uuid: randomUUID(),
    session_id: SESSION,
  })
  assert.deepEqual(
    h.updates.map(({ update }) => update._meta?.['ai.nuphos/promptSuggestion']).filter(Boolean),
    [{ suggestion: 'run the tests' }],
  )
})
