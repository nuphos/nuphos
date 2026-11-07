import { describe, expect, test } from 'bun:test'

import { agentConversations } from '@/lib/agent/db/shared'
import { useDb } from '@/lib/test/doubles/db'
import { useRuntimeRegistry } from '@/lib/test/doubles/runtime-registry'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import { resolveConversationChatRuntime } from './conversation-chat-route'

const TEAM = '64b000000000000000000001'
const memory = portabilityDb()

useDb({ db: () => memory })
useRuntimeRegistry({
  listTeamRuntimes: async () => [],
  resolveTeamRuntimeEndpoints: async () => [],
})

describe('a conversation no runtime could take', () => {
  test('stays unpinned, so it can take its owner’s default once one exists', async () => {
    const bot = {
      sessionId: 'bot',
      userId: 'owner',
      teamId: TEAM,
      title: 'Bot',
      firstMessage: '',
      messageCount: 0,
      createdAt: new Date(),
      lastActiveAt: new Date(),
    }

    await agentConversations().insertOne(bot)
    await expect(resolveConversationChatRuntime(TEAM, bot)).rejects.toMatchObject({
      code: 'claude_code_setup_required',
    })
    expect((await agentConversations().findOne({ sessionId: 'bot' }))?.agentRuntime).toBeUndefined()
  })
})
