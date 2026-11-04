import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'

import { localRuntimeUrl } from '@/lib/agent/devices/local-runtime/address'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useDb } from '@/lib/test/doubles/db'
import { useSessionExecutionState } from '@/lib/test/doubles/session-execution-state'

import { registry, sessionsByConversation } from './agent-chat-registry'
import { runClaudeCodePreviewPrompt } from './agent-chat-runtime'

import type { PromptSessionContext } from './openab-acp-session'
import type { TeamPreviewClient } from './team-openab-runtime'

const mac = { userId: 'owner', deviceId: 'mac', provider: 'claude-code' } as const
// The owner's turns attached the session; a teammate who may use the computer sends next.
const attachment = { openabSessionId: 'session', runtimeUrl: localRuntimeUrl(mac, 'team') }
const endpoint = {
  url: localRuntimeUrl(mac, 'team', 'teammate'),
  authKey: 'transport-fixture',
  provider: 'claude-code' as const,
}
const calls: string[] = []
const noop = () => {}
const client = {
  loadSession: async (
    _session: string,
    _cwd: string,
    _mcp: unknown,
    _prompt: string | undefined,
    runtime: PromptSessionContext['runtime'],
  ) => {
    calls.push('load')

    return { alive: true }
  },
  prompt: async (
    _session: string,
    _text: string,
    _onText: unknown,
    _onUpdate: unknown,
    _onPermission: unknown,
    _onAccepted: unknown,
    context?: PromptSessionContext,
  ) => {
    calls.push('prompt')

    return { stopReason: 'end_turn' }
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
  consumeConversationWorkLost: async () => false,
})
useDb({ db: () => ({ collection: () => ({ findOne: async () => null }) }) })
useSessionExecutionState({
  probeExecutionState: async () => ({ schemaVersion: 2, actions: { send: true } }),
})

beforeEach(() => {
  calls.length = 0
  acquire = spyOn(registry, 'acquire').mockResolvedValue(client)
})
afterEach(() => {
  acquire.mockRestore()
  sessionsByConversation.delete('team:conversation')
})

test('a teammate’s turn on the owner’s computer resumes its session instead of “runtime changed”', async () => {
  const result = await runClaudeCodePreviewPrompt({
    teamId: 'team',
    conversationId: 'conversation',
    userId: 'teammate',
    conversationOwnerUserId: 'owner',
    locale: 'en-US',
    message: '',
    text: 'test',
    endpoint,
    runtime: { provider: 'claude-code', env: { NUPHOS_TOKEN: 'teammate-turn' } },
    signal: new AbortController().signal,
    onTextDelta: noop,
  })

  expect(result.stopReason).toBe('end_turn')
  expect(calls).toEqual(['load', 'prompt'])
  expect(sessionsByConversation.get('team:conversation')?.openabSessionId).toBe('session')
})
