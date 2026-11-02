import '@/routes/agent'

import { beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useConversationsListView } from '@/lib/test/doubles/conversations-list-view'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useResourceRecheck } from '@/lib/test/doubles/resource-recheck'

import { agent } from './router'

import type { AgentConversation } from '@/lib/agent/db'

const teamId = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const caller = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const listed = (sessionId: string) => ({ sessionId, userId: caller, teamId }) as AgentConversation
let rechecked: string[] = []

useIdentity({
  authenticateToken: async () => ({ user: { id: caller } }),
  getTeamMembership: async () => ({ role: 'MEMBER' }),
})
useAgentDb({
  getConversations: async () => ({
    conversations: [listed('s1'), listed('s2')],
    parents: [listed('parent')],
    nextCursor: null,
    hasMore: false,
  }),
})
useConversationsListView({ serializeConversationList: async () => [] })
useResourceRecheck({
  recheckLinkedResources: async (conversation) => {
    rechecked.push(conversation.sessionId)
  },
})
const app = new Hono().route('/agent', agent)

beforeEach(() => {
  rechecked = []
})

test('the sidebar list rechecks its rows’ tags, as opening a conversation does', async () => {
  const response = await app.request(`/agent/conversations?teamId=${teamId}`, {
    headers: { authorization: 'Bearer test-token' },
  })

  expect(response.status).toBe(200)
  // A row's PR may sit in a repository whose events never reach its installation.
  expect(rechecked).toEqual(['s1', 's2'])
})
