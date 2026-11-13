import { beforeEach, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useAgentRunStore } from '@/lib/test/doubles/agent-run-store'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useSessionExecutionState } from '@/lib/test/doubles/session-execution-state'

import { threadToolModule } from './threads'

const MINE = '00000000-0000-4000-8000-000000000001'
const THEIRS = '00000000-0000-4000-8000-000000000002'
const owners: Record<string, string> = { source: 'owner', [MINE]: 'owner', [THEIRS]: 'other' }
let state = 'idle'
let cancelled: string[] = []

useIdentity({ getTeamMembership: async () => ({ role: 'ADMIN' }) })
useAgentDb({
  getConversationBySessionId: async (id) =>
    owners[id]
      ? {
          sessionId: id,
          userId: owners[id],
          teamId: 'team',
          title: id,
          firstMessage: '',
          messageCount: 1,
          createdAt: new Date(),
          lastActiveAt: new Date(),
        }
      : null,
})
useAgentRunStore({ getActiveAgentRunForSession: async () => null })
useSessionExecutionState({
  conversationExecutionState: async () => ({ state }),
  cancelConversationRuntime: async (conversation) => {
    cancelled.push(conversation.sessionId)
  },
})

beforeEach(() => {
  state = 'idle'
  cancelled = []
})

const stop = (threadId: string) =>
  threadToolModule()
    .handlers({ userId: 'owner', teamId: 'team', sessionId: 'source', locale: 'en' })
    .stop_thread?.({ label: 'x', threadId })

test('stop_thread stops a running turn through the conversation Stop path', async () => {
  state = 'active'
  const result = await stop(MINE)

  expect(cancelled).toEqual([MINE])
  expect(result).toMatchObject({ structuredContent: { status: 'stopped' } })
})

test('stop_thread says so when nothing was running', async () => {
  const result = await stop(MINE)

  expect(result).toMatchObject({
    structuredContent: { status: 'idle', note: 'No turn was running, so nothing was stopped.' },
  })
})

test("stop_thread refuses someone else's conversation, even for a team admin", async () => {
  state = 'active'
  const result = await stop(THEIRS)

  expect(result).toMatchObject({ isError: true })
  expect(JSON.stringify(result)).toContain('a conversation you own')
  expect(cancelled).toEqual([])
})
