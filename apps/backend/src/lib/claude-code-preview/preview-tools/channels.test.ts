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
  getTeamMembers: async () =>
    [
      { id: 'owner', name: 'Owner', email: 'owner@example.com' },
      { id: 'alice', name: 'Alice', email: 'Alice@example.com' },
      { id: 'bob', name: 'Bob', email: 'bob@example.com' },
    ] as never,
})
useAgentDb({
  appendConversationMessages: async (data) => {
    appended.push(data)

    return true
  },
})

async function seed(sessionId: string, extra: Partial<AgentConversation> = {}) {
  await agentConversations().insertOne({
    // The in-memory upsert tells rows apart by _id.
    _id: sessionId as never,
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

const channels = () => agentConversations().find({ kind: 'channel' }).toArray()

test('an agent opens a channel as its owner and invites teammates', async () => {
  const result = await tools('agent-a').channel_create?.({
    label: 'x',
    name: 'Launch',
    people: ['alice', 'BOB@example.com', 'owner'],
    message: 'Opening this to plan the launch.',
  })
  const { channelId } = (result as { structuredContent: { channelId: string } }).structuredContent
  const channel = await agentConversations().findOne({ sessionId: channelId })

  expect(channel).toMatchObject({
    kind: 'channel',
    userId: 'owner',
    teamId: 'team',
    title: 'Launch',
    agentSessionIds: ['agent-a'],
    participantIds: ['alice', 'bob'],
  })
  expect(appended).toHaveLength(1)
  expect(appended[0]).toMatchObject({
    sessionId: channelId,
    messages: [
      {
        parts: [{ type: 'text', text: 'Opening this to plan the launch.' }],
        metadata: { sender: { type: 'agent', id: 'agent-a' } },
      },
    ],
  })
})

test('only teammates and the owner’s own agents can be brought in', async () => {
  const before = (await channels()).length
  const outsider = await tools('agent-a').channel_create?.({
    label: 'x',
    name: 'Nope',
    people: ['alice', 'stranger@example.com'],
  })

  expect(JSON.stringify(outsider)).toContain('stranger@example.com')
  await seed('someone-elses-agent', { userId: 'bob' })
  const foreignAgent = await tools('agent-a').channel_create?.({
    label: 'x',
    name: 'Nope',
    people: ['alice'],
    agents: ['someone-elses-agent'],
  })

  expect(foreignAgent).toMatchObject({ isError: true })
  expect(await channels()).toHaveLength(before)
})

test('an agent whose owner left the team cannot open a channel', async () => {
  ownerOnTeam = false
  const result = await tools('agent-a').channel_create?.({
    label: 'x',
    name: 'Nope',
    people: ['alice'],
  })

  expect(JSON.stringify(result)).toContain('no longer on the team')
})
