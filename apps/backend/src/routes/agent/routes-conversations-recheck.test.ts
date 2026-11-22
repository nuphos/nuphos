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

test('the sidebar list does not recheck its rows’ linked resources', async () => {
  const response = await app.request(`/agent/conversations?teamId=${teamId}`, {
    headers: { authorization: 'Bearer test-token' },
  })

  expect(response.status).toBe(200)
  // Rechecking every listed row spent the GitHub installation's rate limit; only the
  // open conversation's resource poll rechecks.
  expect(rechecked).toEqual([])
})
