import { expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useIdentity } from '@/lib/test/doubles/identity'

import { threadToolModule } from './threads'

import type { PreviewToolContext } from '../preview-tool-context'

useIdentity({ getTeamMembership: async () => ({ role: 'MEMBER' }) })
useAgentDb({
  getConversationBySessionId: async (id) =>
    id === 'source'
      ? {
          sessionId: 'source',
          userId: 'owner',
          teamId: 'team',
          title: 'Source',
          firstMessage: '',
          messageCount: 1,
          createdAt: new Date(),
          lastActiveAt: new Date(),
          credentialAccess: { updatedAt: new Date(), updatedBy: 'owner' },
        }
      : null,
})

test('a refused change reaches the agent as its reason, not an internal error', async () => {
  const ctx = { userId: 'owner', teamId: 'team', sessionId: 'source', locale: 'en' }
  const tools = threadToolModule().handlers(ctx as PreviewToolContext)
  const result = await tools.update_thread?.({
    label: 'x',
    threadId: '00000000-0000-4000-8000-000000000000',
    fullAccess: false,
  })

  expect(result).toMatchObject({ isError: true })
  expect(JSON.stringify(result)).toContain('another unarchived conversation you own')
})
