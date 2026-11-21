import { beforeEach, describe, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useConversationTurn } from '@/lib/test/doubles/conversation-turn'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useSlackAgentBot } from '@/lib/test/doubles/slack-agent-bot'
import { useSlackInstallations } from '@/lib/test/doubles/slack-installations'

const started: string[] = []
const marked: string[] = []

useSlackInstallations({
  resolveSlackBotForWorkspace: () =>
    Promise.resolve({ botToken: 'xoxb-1', botUserId: 'UBOT' } as never),
})
useSlackAgentBot({
  // A row written by the removed channel wake still carries its field.
  getSlackChannelMapping: () =>
    Promise.resolve({ teamId: 'team-1', wakeSessionId: 'session-1', enabled: true } as never),
  markSlackEvent: (_id: string, status: string) => {
    marked.push(status)

    return Promise.resolve()
  },
})
useAgentDb({
  getConversationBySessionId: () =>
    Promise.resolve({ sessionId: 'session-1', userId: 'owner-1', teamId: 'team-1' } as never),
})
useIdentity({ getTeamMembership: () => Promise.resolve({ role: 'MEMBER' } as never) })
useConversationTurn({
  startConversationTurn: (data) => {
    started.push(data.targetSessionId)

    return Promise.resolve({ status: 'started' as const, run: Promise.resolve(undefined) })
  },
})

const { handleThreadMessage } = await import('@/routes/slack/thread-message')

beforeEach(() => {
  started.length = 0
  marked.length = 0
})

describe('handleThreadMessage', () => {
  test('a top-level channel message wakes no conversation', async () => {
    await handleThreadMessage({
      type: 'event_callback',
      team_id: 'T1',
      event_id: 'Ev1',
      event: { type: 'message', channel: 'C1', user: 'U1', ts: '10.1', text: 'hello' },
    } as never)

    expect(started).toEqual([])
    expect(marked).toEqual(['ignored'])
  })
})
