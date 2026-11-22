import { expect, spyOn, test } from 'bun:test'

import { useConversationChatRoute } from '@/lib/test/doubles/conversation-chat-route'

import { OpenAbAcpClient } from './openab-acp-client'
import { OpenAbConnectionLostError, OpenAbRpcError } from './openab-acp-errors'
import { conversationSessionConfig } from './session-config'

import type { AgentConversation } from '@/lib/agent/db'

const RUNTIME_URL = 'ws://runtime.test/acp'

useConversationChatRoute({
  resolveConversationChatRuntime: async () =>
    ({ endpoint: { url: RUNTIME_URL, authKey: 'key', runtimeId: 'runtime' } }) as never,
})

// The owner opens a recent chat, so reading its settings prewarms the session.
const recentChat = (sessionId: string) =>
  ({
    sessionId,
    userId: 'owner',
    teamId: 'team',
    lastActiveAt: new Date(),
    claudeCodePreview: { openabSessionId: `${sessionId}-openab`, runtimeUrl: RUNTIME_URL },
  }) as unknown as AgentConversation

// Prewarms the chat against a session whose settings read fails, and returns
// the first line logged once the prewarm gives up.
async function prewarmFailing(sessionId: string, failure: Error) {
  const client = {
    initialize: async () => ({}),
    getSessionConfigOptions: () => Promise.reject(failure),
    close: () => {},
  } as unknown as OpenAbAcpClient
  const connect = spyOn(OpenAbAcpClient, 'connect').mockResolvedValue(client)
  let error = spyOn(console, 'error')
  let warn = spyOn(console, 'warn')
  const logged = new Promise<{ level: string; line: string }>((resolve) => {
    error = error.mockImplementation((line: string) => resolve({ level: 'error', line }))
    warn = warn.mockImplementation((line: string) => resolve({ level: 'warn', line }))
  })

  try {
    await conversationSessionConfig(recentChat(sessionId), undefined, 'owner')

    return await logged
  } finally {
    connect.mockRestore()
    error.mockRestore()
    warn.mockRestore()
  }
}

test('a host that hangs up during a prewarm, as while it restarts, is a warning and not an error', async () => {
  const { level, line } = await prewarmFailing(
    'restarting',
    new OpenAbConnectionLostError('Connection ended'),
  )

  expect(level).toBe('warn')
  expect(JSON.parse(line)).toMatchObject({
    event: 'agent.session.prewarm_failed',
    session_id: 'restarting',
  })
})

// The runtime answers this way while a turn holds the session; the turn and the
// next prompt are unaffected, so the prewarm has nothing to report as an error.
test('a runtime busy with a turn that does not confirm a prewarm is a warning and not an error', async () => {
  const { level, line } = await prewarmFailing(
    'busy',
    new OpenAbRpcError('Runtime did not confirm session configuration', -32603),
  )

  expect(level).toBe('warn')
  expect(JSON.parse(line)).toMatchObject({
    event: 'agent.session.prewarm_failed',
    session_id: 'busy',
    error_message: 'Runtime did not confirm session configuration',
  })
})
