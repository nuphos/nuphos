import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useDb } from '@/lib/test/doubles/db'
import { useSessionExecutionState } from '@/lib/test/doubles/session-execution-state'

import { registry, sessionsByConversation } from './agent-chat-registry'
import { runClaudeCodePreviewPrompt } from './agent-chat-runtime'
import { OpenAbRpcError } from './openab-acp-errors'

import type { TeamPreviewClient } from './team-openab-runtime'

const endpoint = {
  url: 'wss://runtime.invalid/acp',
  authKey: 'transport-fixture',
  provider: 'claude-code' as const,
}
const attachment = {
  openabSessionId: 'session',
  runtimeUrl: endpoint.url,
  runtimeDefaults: { model: 'opus' },
}
const noop = () => {}
let promptError: Error
let forgotten: unknown[] | undefined
let forgetFails = false
const client = {
  loadSession: async () => ({ alive: true }),
  prompt: async () => {
    throw promptError
  },
  onSessionUpdate: () => noop,
  onSessionPermission: () => noop,
  onClosed: () => noop,
  onRetired: () => noop,
} as unknown as TeamPreviewClient
let acquire: ReturnType<typeof spyOn>

useAgentDb({
  getConversationPreviewAttachment: async () => attachment,
  consumeConversationRetracted: async () => false,
  consumeConversationWorkLost: async () => null,
  forgetConversationPreviewSession: async (...args: unknown[]) => {
    forgotten = args
    if (forgetFails) throw new Error('database unavailable')
  },
})
useDb({ db: () => ({ collection: () => ({ findOne: async () => null }) }) })
useSessionExecutionState({
  probeExecutionState: async () => ({ schemaVersion: 2, actions: { send: true } }),
})
beforeEach(() => {
  forgotten = undefined
  forgetFails = false
  sessionsByConversation.set('team:conversation', {
    teamId: 'team',
    conversationId: 'conversation',
    userId: 'user',
    locale: 'en-US',
    openabSessionId: 'session',
    endpoint,
    client,
    mcpServers: [],
    contextDeliveredAt: Date.now(),
  })
  acquire = spyOn(registry, 'acquire').mockResolvedValue(client)
})
afterEach(() => {
  acquire.mockRestore()
  sessionsByConversation.delete('team:conversation')
})

const run = () =>
  runClaudeCodePreviewPrompt({
    teamId: 'team',
    conversationId: 'conversation',
    userId: 'user',
    locale: 'en-US',
    message: '',
    text: 'Continue',
    endpoint,
    signal: new AbortController().signal,
    onTextDelta: noop,
  })

// A runtime before 0.1.62 keeps prompting a session its agent lost, so every later
// message fails the same way. Forgetting the session lets the next one open a new
// session, as a brand-new conversation does, with the settings it ran with.
test.each([
  [
    'claude-agent-acp "Session not found"',
    new OpenAbRpcError(
      '**Internal Error** (code: -32603)\nInternal error\n> Session not found',
      -32603,
    ),
  ],
  [
    'ACP "resource not found"',
    new OpenAbRpcError(
      '**Server Error** (code: -32002)\nResource not found: 3f2a\n> {"uri":"3f2a"}',
      -32002,
    ),
  ],
])('a prompt the agent answers with %s forgets the session', async (_name, error) => {
  promptError = error

  await expect(run()).rejects.toBe(error)
  expect(forgotten).toEqual(['conversation', 'team', 'session', { model: 'opus' }])
})

test.each([
  [
    'an internal error',
    new OpenAbRpcError('**Internal Error** (code: -32603)\nInternal error\n> boom', -32603),
  ],
  // The gateway's own -32002 is about the transport, not the agent's session.
  ['the gateway\'s "Not initialized"', new OpenAbRpcError('Not initialized', -32002)],
])('a prompt failing with %s keeps the session', async (_name, error) => {
  promptError = error

  await expect(run()).rejects.toBe(error)
  expect(forgotten).toBeUndefined()
})

// The user needs the agent's error, not the database's: a failed forget is only logged.
test("a forget that cannot be written still fails the turn with the agent's error", async () => {
  const error = new OpenAbRpcError(
    '**Internal Error** (code: -32603)\nInternal error\n> Session not found',
    -32603,
  )

  promptError = error
  forgetFails = true

  await expect(run()).rejects.toBe(error)
  expect(forgotten).toBeDefined()
})
