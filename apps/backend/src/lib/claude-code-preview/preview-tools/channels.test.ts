import { afterEach, beforeEach, expect, test } from 'bun:test'

import { agentConversations } from '@/lib/agent/db'
import { installTurnRunner, resetTurnRunner } from '@/lib/agent/turn-runner'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import { channelToolModule } from './channels'

import type { PreviewToolContext } from '../preview-tool-context'
import type { AgentConversation } from '@/lib/agent/db'
import type * as agentDb from '@/lib/agent/db'
import type * as dbActual from '@/lib/db'

const CHANNEL = '00000000-0000-4000-8000-000000000001'
const OTHER_CHANNEL = '00000000-0000-4000-8000-000000000002'
let memory = portabilityDb()
let appended: Parameters<typeof agentDb.appendConversationMessages>[0][] = []

useDb({ db: (() => memory) as unknown as typeof dbActual.db })
let ownerOnTeam = true

useIdentity({
  getTeamMembership: async () => (ownerOnTeam ? ({ role: 'MEMBER' } as never) : null),
})
useAgentDb({
  appendConversationMessages: async (data) => {
    appended.push(data)

    return true
  },
})

async function seed(sessionId: string, extra: Partial<AgentConversation> = {}) {
  await agentConversations().insertOne({
    sessionId,
    userId: 'owner',
    teamId: 'team',
    title: `${sessionId} title`,
    firstMessage: '',
    messageCount: 0,
    createdAt: new Date(),
    lastActiveAt: new Date(),
    ...extra,
  })
}

const tools = (sessionId: string) =>
  channelToolModule().handlers({
    userId: 'teammate',
    teamId: 'team',
    sessionId,
    locale: 'en',
  } as PreviewToolContext)

beforeEach(async () => {
  memory = portabilityDb()
  ownerOnTeam = true
  appended = []
  installTurnRunner({
    claimAgentRunOrEnqueue: async () => ({ mode: 'queued' }),
  })
  await seed(CHANNEL, { kind: 'channel', agentSessionIds: ['agent-a', 'agent-b'] })
  await seed(OTHER_CHANNEL, { kind: 'channel', agentSessionIds: ['agent-b'] })
  await seed('agent-a', { agentRuntime: 'claude-code' })
  await seed('agent-b')
})
afterEach(() => {
  resetTurnRunner()
})

test('only a channel the conversation is in can be read', async () => {
  for (const channelId of [OTHER_CHANNEL, '00000000-0000-4000-8000-000000000003']) {
    const read = await tools('agent-a').channel_read?.({ label: 'x', channelId })

    expect(read).toMatchObject({ isError: true })
    expect(JSON.stringify(read)).toContain('not in that channel')
  }
  // Another team's copy of the same membership is no membership.
  await agentConversations().updateOne({ sessionId: CHANNEL }, { $set: { teamId: 'other-team' } })
  expect(await tools('agent-a').channel_read?.({ label: 'x', channelId: CHANNEL })).toMatchObject({
    isError: true,
  })
  expect(appended).toHaveLength(0)
})

test('a member reads the channel', async () => {
  const result = await tools('agent-a').channel_read?.({ label: 'x', channelId: CHANNEL })

  expect(result).toMatchObject({ structuredContent: { messages: [], more: false } })
})

test('an agent whose owner left the team cannot read', async () => {
  ownerOnTeam = false
  const read = await tools('agent-a').channel_read?.({ label: 'x', channelId: CHANNEL })

  expect(JSON.stringify(read)).toContain('no longer on the team')
  expect(appended).toHaveLength(0)
})
