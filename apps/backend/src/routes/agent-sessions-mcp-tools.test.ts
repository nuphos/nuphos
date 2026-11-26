import { expect, test } from 'bun:test'

import { mintPreviewMcpToken } from '@/lib/claude-code-preview/mcp-token'
import { useAgentsIdentity } from '@/lib/test/doubles/agents-identity'
import { useIdentity } from '@/lib/test/doubles/identity'
import { usePreviewToolContextResolve } from '@/lib/test/doubles/preview-tool-context-resolve'
import { usePreviewTools } from '@/lib/test/doubles/preview-tools'
import { useTokenRevocation } from '@/lib/test/doubles/token-revocation'
import { agentSessions } from '@/routes/agent-sessions'

const USER = '64b000000000000000000001'
const TEAM = '64b000000000000000000002'

useTokenRevocation({ isTokenRevoked: async () => false, inheritRevocation: async () => false })
useAgentsIdentity({
  verifyAgentForActor: async (userId, owner, sessionId) => ({
    userId,
    sessionId,
    conversationOwnerUserId: owner,
  }),
})
useIdentity({
  getTeamMembership: async () => ({ role: 'EDITOR', team: { id: TEAM } }),
})
usePreviewToolContextResolve({
  resolvePreviewToolContext: async (args) => ({ ...args, locale: 'en' }),
})

// Counts how often the tool modules are built, so the test can see the handshake skip it.
let built = 0

usePreviewTools({
  previewToolModules: async () => {
    built++

    return [
      {
        definitions: [{ name: 'probe', inputSchema: { type: 'object' } }],
        handlers: () => ({ probe: async () => ({ content: [{ type: 'text', text: 'pong' }] }) }),
      },
    ]
  },
})

async function rpc(method: string, params?: unknown) {
  const token = await mintPreviewMcpToken({ userId: USER, sessionId: 'conv-1', teamId: TEAM })
  const response = await agentSessions.request(`/conv-1/teams/${TEAM}/mcp-tools`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })

  return { status: response.status, body: (await response.json()) as { result?: any } }
}

test('/mcp-tools answers the handshake without building tools, then lists and calls them', async () => {
  built = 0
  const init = await rpc('initialize')

  expect(init.status).toBe(200)
  expect(init.body.result.serverInfo.name).toBe('nuphos-tools')
  expect(built).toBe(0)

  const list = await rpc('tools/list')

  expect(list.body.result.tools.map((tool: { name: string }) => tool.name)).toEqual(['probe'])

  const call = await rpc('tools/call', { name: 'probe', arguments: {} })

  expect(call.body.result.content[0].text).toBe('pong')
  expect(built).toBe(2)
})
