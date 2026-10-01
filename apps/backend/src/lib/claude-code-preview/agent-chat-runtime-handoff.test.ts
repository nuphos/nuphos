import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'

import { registry, sessionsByConversation } from './agent-chat-registry'
import { runClaudeCodePreviewPrompt } from './agent-chat-runtime'

import type { TeamPreviewClient } from './team-openab-runtime'

import { RunHandoff } from '@/lib/lifecycle'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useDb } from '@/lib/test/doubles/db'
import { useSessionExecutionState } from '@/lib/test/doubles/session-execution-state'

const endpoint = {
  url: 'wss://runtime.invalid/acp',
  authKey: 'k',
  provider: 'claude-code' as const,
}
const attachment = { openabSessionId: 'session', runtimeUrl: endpoint.url }
const noop = () => {}
let cancels: string[] = []
let admitted: () => void = noop
let acquire: ReturnType<typeof spyOn>

const client = {
  loadSession: async () => ({ alive: true }),
  prompt: (
    _session: string,
    _message: string,
    _text: unknown,
    _update: unknown,
    _permission: unknown,
    onAccepted?: () => void,
  ) =>
    new Promise(() => {
      onAccepted?.()
      admitted()
    }),
  cancel: (session: string) => {
    cancels.push(session)
  },
  onSessionUpdate: () => noop,
  onSessionPermission: () => noop,
  onClosed: () => noop,
  onRetired: () => noop,
} as unknown as TeamPreviewClient

useAgentDb({
  getConversationPreviewAttachment: async () => attachment,
  consumeConversationWorkLost: async () => null,
})
useDb({ db: () => ({ collection: () => ({ findOne: async () => null }) }) })
useSessionExecutionState({
  conversationExecutionState: async () => ({ schemaVersion: 2, actions: { send: true } }),
})

beforeEach(() => {
  cancels = []
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

async function admittedTurn(controller: AbortController): Promise<void> {
  const running = new Promise<void>((resolve) => {
    admitted = resolve
  })

  void runClaudeCodePreviewPrompt({
    teamId: 'team',
    conversationId: 'conversation',
    userId: 'user',
    locale: 'en-US',
    message: 'Keep going',
    endpoint,
    signal: controller.signal,
    onTextDelta: noop,
  })
  await running
}

test('a replica shutting down lets go of a running turn without cancelling it', async () => {
  const controller = new AbortController()

  await admittedTurn(controller)
  controller.abort(new RunHandoff('backend shutdown'))

  expect(cancels).toEqual([])
})

test('a user stop still cancels the running turn', async () => {
  const controller = new AbortController()

  await admittedTurn(controller)
  controller.abort()

  expect(cancels).toEqual(['session'])
})
