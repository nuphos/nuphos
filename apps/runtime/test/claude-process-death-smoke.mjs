/* eslint-disable sonarjs/no-internal-api-use -- Regression tests exercise the exact pinned adapter bundle patched in the runtime image. */
// When Claude Code dies under the patched adapter, the adapter must exit so
// OpenAB rebuilds the conversation's connection and resumes it via
// session/load. A stream error that is not a process death keeps it running.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { ClaudeAcpAgent } from '../image/claude-agent-acp/node_modules/@agentclientprotocol/claude-agent-acp/dist/acp-agent.js'
import { Pushable } from '../image/claude-agent-acp/node_modules/@agentclientprotocol/claude-agent-acp/dist/utils.js'

const tick = () => new Promise((resolve) => setImmediate(resolve))

async function run(t, failure) {
  const exits = []
  t.mock.method(process, 'exit', (code) => exits.push(code))
  const errors = []
  const agent = new ClaudeAcpAgent(
    { sessionUpdate: async () => {} },
    { log: () => {}, error: (e) => errors.push(String(e)) },
  )
  const settled = []
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
    owedTrailingIdles: 0,
    messageIdToUuid: new Map(),
    sessionFailureState: { epoch: randomUUID(), revisions: new Map(), active: new Map() },
    fileChangeReportRequestIds: new Set(),
    turnQueue: [turn],
    activeTurn: turn,
    input: new Pushable(),
    query: {
      next: async () => {
        throw new Error(failure)
      },
      [Symbol.asyncIterator]() {
        return this
      },
      close() {},
      interrupt: async () => {},
    },
  }
  agent.sessions['test-session'] = session
  await agent.runConsumer(session, { sessionId: 'test-session' })
  for (let n = 0; n < 20; n++) await tick()

  return { agent, exits, errors, settled }
}

test('the adapter exits when its Claude Code process dies', async (t) => {
  const { agent, exits, errors, settled } = await run(
    t,
    'Claude Code process terminated by signal SIGABRT',
  )

  assert.deepEqual(exits, [1])
  assert.equal(agent.sessions['test-session'], undefined)
  assert.ok(errors.some((e) => e.includes('Claude Agent process died')))
  // The in-flight turn is failed before the exit, so its error reaches the gateway,
  // naming the cause and that the next message continues.
  assert.equal(settled.length, 1)
  assert.match(settled[0].message, /terminated by signal SIGABRT/)
  assert.match(settled[0].message, /Send a message to continue/)
})

test('the adapter keeps running after a stream error that is not a process death', async (t) => {
  const { exits } = await run(t, 'stream reset by peer')

  assert.deepEqual(exits, [])
})
