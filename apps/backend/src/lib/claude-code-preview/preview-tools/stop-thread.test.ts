import { afterEach, beforeEach, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useAgentRunStore } from '@/lib/test/doubles/agent-run-store'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useSessionExecutionState } from '@/lib/test/doubles/session-execution-state'

import {
  buildPendingUserMessage,
  clearPendingUserMessages,
  enqueuePendingUserMessage,
} from '@/lib/agent/pending-messages'
import { listPendingUserMessages } from '@/lib/agent/pending-queue'

import { threadToolModule } from './threads'

const SOURCE = '00000000-0000-4000-8000-000000000000'
const MINE = '00000000-0000-4000-8000-000000000001'
const THEIRS = '00000000-0000-4000-8000-000000000002'
const owners: Record<string, string> = { [SOURCE]: 'owner', [MINE]: 'owner', [THEIRS]: 'other' }
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
  cancelConversationRuntime: async (conversation) => {
    cancelled.push(conversation.sessionId)
  },
})

beforeEach(() => {
  cancelled = []
})
afterEach(async () => {
  await clearPendingUserMessages('owner', MINE)
})

const stop = (threadId: string) =>
  threadToolModule()
    .handlers({ userId: 'owner', teamId: 'team', sessionId: SOURCE, locale: 'en' })
    .stop_thread?.({ label: 'x', threadId })

test('stop_thread stops the turn and drops what agents queued, keeping people', async () => {
  const queue = (source: string, actorUserId?: string) =>
    enqueuePendingUserMessage(
      'owner',
      MINE,
      buildPendingUserMessage({ renderedText: source, source, actorUserId }),
    )

  await queue('agent.thread')
  await queue('app', 'owner')
  await queue('agent.thread')
  const result = await stop(MINE)

  expect(cancelled).toEqual([MINE])
  expect(result).toMatchObject({
    structuredContent: { status: 'stopped', droppedQueuedMessages: 2 },
  })
  expect((await listPendingUserMessages('owner', MINE)).map((m) => m.source)).toEqual(['app'])
})

test("stop_thread refuses someone else's conversation, even for a team admin", async () => {
  const result = await stop(THEIRS)

  expect(result).toMatchObject({ isError: true })
  expect(JSON.stringify(result)).toContain('conversation you own')
  expect(cancelled).toEqual([])
})

test('stop_thread refuses the conversation calling it', async () => {
  expect(await stop(SOURCE)).toMatchObject({ isError: true })
  expect(cancelled).toEqual([])
})
