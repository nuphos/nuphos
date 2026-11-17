import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'

import { agentConversations, agentMessages } from '@/lib/agent/db'
import * as transfers from '@/lib/file-transfer/service'
import { installTurnRunner, resetTurnRunner } from '@/lib/agent/turn-runner'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import * as executionState from '../session-execution-state'

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
  await seed('agent-a', { agentRuntime: 'claude-code', avatar: '07-ada' })
  await seed('agent-b', { avatar: '05-rembrandt' })
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

test('a Task opens a chat with the Bot above it in its place', async () => {
  await seed('task-a', { parentSessionId: 'agent-a' })
  const result = await tools('task-a').channel_create?.({
    label: 'x',
    name: 'Launch',
    people: ['alice'],
    message: 'Hello.',
  })
  const { channelId } = (result as { structuredContent: { channelId: string } }).structuredContent

  expect((await agentConversations().findOne({ sessionId: channelId }))?.agentSessionIds).toEqual([
    'agent-a',
  ])
  expect(appended[0]).toMatchObject({
    messages: [{ metadata: { sender: { type: 'agent', id: 'agent-a' } } }],
  })
})

test('a Task with no Bot above it, or a Task brought in, opens no chat', async () => {
  const before = (await channels()).length

  await seed('task-alone')
  await seed('task-b', { parentSessionId: 'agent-a' })
  const alone = await tools('task-alone').channel_create?.({
    label: 'x',
    name: 'Nope',
    people: ['alice'],
  })
  const withTask = await tools('agent-a').channel_create?.({
    label: 'x',
    name: 'Nope',
    people: ['alice'],
    agents: ['task-b'],
  })

  expect(JSON.stringify(alone)).toContain('Only a Bot can be in a chat')
  expect(JSON.stringify(withTask)).toContain('Only a Bot can be in a chat')
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

test('files posted with a message are placed on the reader’s runtime, under their uploader', async () => {
  // Uploads resolve under a real team id.
  const team = '69e989027ab63e8d6a0ffcb6'
  const chat = '00000000-0000-4000-8000-000000000009'

  await seed(chat, { kind: 'channel', agentSessionIds: ['agent-c'], teamId: team, messageCount: 1 })
  await seed('agent-c', { teamId: team })
  await agentMessages().insertOne({
    sessionId: chat,
    userId: 'owner',
    index: 0,
    messageId: 'm1',
    role: 'user',
    parts: [{ type: 'transfer-upload', groupId: 'g1', status: 'ready', files: [] }],
    metadata: {
      version: 1,
      sender: { type: 'user', id: 'mei', displayName: 'Mei' },
      source: 'nuphos',
      sentAt: new Date().toISOString(),
    },
  } as never)
  const resolve = spyOn(transfers, 'resolveDownloads').mockResolvedValue({
    files: [{ fileName: 'shot.png', size: 42, status: 'ready', downloadUrl: 'https://s/1' }],
  } as unknown as Awaited<ReturnType<typeof transfers.resolveDownloads>>)
  const place = spyOn(executionState, 'placeOnConversationRuntime').mockResolvedValue([
    '/work/attachments/shot.png',
  ])

  try {
    const read = channelToolModule().handlers({
      userId: 'teammate',
      teamId: team,
      sessionId: 'agent-c',
      locale: 'en',
    } as PreviewToolContext).channel_read
    const text = JSON.stringify(await read?.({ label: 'x', channelId: chat }))

    expect(text).toContain('/work/attachments/shot.png')
    expect(text).toContain('already on this runtime')
    expect(text).not.toContain('uploads')
    expect(resolve.mock.calls[0]![0]).toMatchObject({ userId: 'mei' })
    // Placed on the reading agent's own runtime, as its owner.
    expect(place.mock.calls[0]![0]).toMatchObject({ sessionId: 'agent-c' })
    expect(place.mock.calls[0]![2]).toBe('owner')
  } finally {
    resolve.mockRestore()
    place.mockRestore()
  }
})

test('a member posts a follow-up into its channel, with only its own finished files', async () => {
  const team = '69e989027ab63e8d6a0ffcb6'
  const chat = '00000000-0000-4000-8000-000000000010'

  await seed(chat, { kind: 'channel', agentSessionIds: ['agent-p'], teamId: team })
  await seed('agent-p', { teamId: team })
  const get = spyOn(transfers, 'getTransferGroup').mockImplementation(async (scope, groupId) => {
    if (groupId === 'theirs') throw new Error('Transfer not found')

    return {
      groupId,
      status: 'ready',
      direction: groupId === 'mine' ? 'download' : 'upload',
    } as Awaited<ReturnType<typeof transfers.getTransferGroup>>
  })
  const post = channelToolModule().handlers({
    userId: 'teammate',
    teamId: team,
    sessionId: 'agent-p',
    locale: 'en',
  } as PreviewToolContext).channel_post

  try {
    expect(
      await post?.({ label: 'x', channelId: chat, text: 'The clips are ready.', files: ['mine'] }),
    ).toMatchObject({ structuredContent: { posted: true, files: 1 } })
    expect(appended[0]).toMatchObject({
      sessionId: chat,
      messages: [
        {
          parts: [
            { type: 'text', text: 'The clips are ready.' },
            { type: 'transfer-download', groupId: 'mine' },
          ],
          metadata: { sender: { type: 'agent', id: 'agent-p' } },
        },
      ],
    })
    // Its own session's files only, under its owner.
    expect(get.mock.calls[0]![0]).toMatchObject({ userId: 'owner', sessionId: 'agent-p' })
    expect(
      await post?.({ label: 'x', channelId: chat, text: 'Theirs.', files: ['theirs'] }),
    ).toMatchObject({ isError: true })
    // Only files it pushed for download, not something uploaded to it.
    expect(
      await post?.({ label: 'x', channelId: chat, text: 'Upload.', files: ['an-upload'] }),
    ).toMatchObject({ isError: true })
    // A channel it is not in is refused.
    expect(await post?.({ label: 'x', channelId: OTHER_CHANNEL, text: 'Hello.' })).toMatchObject({
      isError: true,
    })
    expect(appended).toHaveLength(1)
  } finally {
    get.mockRestore()
  }
})
