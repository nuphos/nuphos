/* eslint-disable sonarjs/no-internal-api-use -- Regression tests exercise the exact pinned adapter bundle patched in the runtime image. */
// A runtime restart (SIGTERM, or the ACP connection closing) must not interrupt
// Claude Code: an interrupt records the running tool as rejected by the user, and
// the resumed agent stops for a user who never asked. A Stop from the client
// still interrupts.
import assert from 'node:assert/strict'
import test from 'node:test'

import { ClaudeAcpAgent } from '../image/claude-agent-acp/node_modules/@agentclientprotocol/claude-agent-acp/dist/acp-agent.js'
import { Pushable } from '../image/claude-agent-acp/node_modules/@agentclientprotocol/claude-agent-acp/dist/utils.js'

function agentWithSession() {
  const calls = []
  const agent = new ClaudeAcpAgent(
    { sessionUpdate: async () => {} },
    { log: () => {}, error: () => {} },
  )
  agent.sessions['test-session'] = {
    cancelled: false,
    queryClosed: false,
    turnQueue: [],
    settingsManager: { dispose() {} },
    input: new Pushable(),
    abortController: new AbortController(),
    cancelController: new AbortController(),
    query: {
      close: () => calls.push('close'),
      interrupt: async () => calls.push('interrupt'),
    },
  }
  return { agent, calls }
}

test('shutting the adapter down closes Claude Code without interrupting it', async () => {
  const { agent, calls } = agentWithSession()

  await agent.dispose()

  assert.deepEqual(calls, ['close'])
})

test('a Stop from the client still interrupts Claude Code', async () => {
  const { agent, calls } = agentWithSession()

  await agent.cancel({ sessionId: 'test-session' }).catch(() => {})

  assert.ok(calls.includes('interrupt'))
})
