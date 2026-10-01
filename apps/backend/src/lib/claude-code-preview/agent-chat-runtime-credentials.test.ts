import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'

import { registry, sessionsByConversation } from './agent-chat-registry'
import { SESSION_CONTEXT_REFRESH_MS, runClaudeCodePreviewPrompt } from './agent-chat-runtime'

import type { PromptSessionContext } from './openab-acp-session'
import type { TeamPreviewClient } from './team-openab-runtime'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useDb } from '@/lib/test/doubles/db'
import { useSessionExecutionState } from '@/lib/test/doubles/session-execution-state'

const endpoint = {
  url: 'wss://runtime.invalid/acp',
  authKey: 'transport-fixture',
  provider: 'codex' as const,
}
const attachment = { openabSessionId: 'session', runtimeUrl: endpoint.url }
const calls: string[] = []
const loadedTokens: (string | undefined)[] = []
const promptedContexts: (PromptSessionContext | undefined)[] = []
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
    loadedTokens.push(runtime?.env?.NUPHOS_TOKEN)

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
    promptedContexts.push(context)

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
  consumeConversationWorkLost: async () => false,
})
useDb({ db: () => ({ collection: () => ({ findOne: async () => null }) }) })
useSessionExecutionState({
  conversationExecutionState: async () => ({ schemaVersion: 2, actions: { send: true } }),
})

function placeSession(contextDeliveredAt: number) {
  sessionsByConversation.set('team:conversation', {
    teamId: 'team',
    conversationId: 'conversation',
    userId: 'user',
    locale: 'en-US',
    openabSessionId: 'session',
    endpoint,
    client,
    mcpServers: [],
    runtime: { provider: 'codex', env: { NUPHOS_TOKEN: 'turn-1' } },
    contextDeliveredAt,
  })
}

beforeEach(() => {
  calls.length = 0
  loadedTokens.length = 0
  promptedContexts.length = 0
  acquire = spyOn(registry, 'acquire').mockResolvedValue(client)
})
afterEach(() => {
  acquire.mockRestore()
  sessionsByConversation.delete('team:conversation')
})

const run = (token: string) =>
  runClaudeCodePreviewPrompt({
    teamId: 'team',
    conversationId: 'conversation',
    userId: 'user',
    locale: 'en-US',
    message: 'Continue',
    endpoint,
    mcpServers: [
      {
        name: 'nuphos-tools',
        type: 'http',
        url: 'http://backend/mcp-tools',
        headers: [{ name: 'Authorization', value: `Bearer ${token}` }],
      },
    ],
    runtime: { provider: 'codex', env: { NUPHOS_TOKEN: token } },
    signal: new AbortController().signal,
    onTextDelta: noop,
  })

test('every prompt on a live session carries the turn’s fresh credentials', async () => {
  placeSession(Date.now())

  await run('turn-2')
  await run('turn-3')

  expect(calls).toEqual(['prompt', 'prompt'])
  expect(promptedContexts.map((context) => context?.runtime?.env?.NUPHOS_TOKEN)).toEqual([
    'turn-2',
    'turn-3',
  ])
  expect(promptedContexts[1]?.mcpServers[0]?.headers).toEqual([
    { name: 'Authorization', value: 'Bearer turn-3' },
  ])
})

test('re-resumes a session whose delivered context is stale before prompting', async () => {
  placeSession(Date.now() - SESSION_CONTEXT_REFRESH_MS - 1)

  await run('turn-2')
  await run('turn-3')

  expect(calls).toEqual(['load', 'prompt', 'prompt'])
  expect(loadedTokens).toEqual(['turn-2'])
  expect(sessionsByConversation.get('team:conversation')?.client).toBe(client)
})
