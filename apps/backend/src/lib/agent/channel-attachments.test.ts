import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'

import * as transfers from '@/lib/file-transfer/service'
import { useDb } from '@/lib/test/doubles/db'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import { channelUploadPart, resolveChannelFiles } from './channel-attachments'
import { agentConversations, agentMessages } from './db/shared'

import type * as dbActual from '@/lib/db'

const TEAM = '69e989027ab63e8d6a0ffcb6'
const channel = { sessionId: 'chat', userId: 'owner', teamId: TEAM }
let memory = portabilityDb()

useDb({ db: (() => memory) as unknown as typeof dbActual.db })

const group = (status: string) =>
  ({
    groupId: 'g1',
    direction: 'upload',
    status,
    files: [{ fileName: 'shot.png', size: 42, status: 'ready', downloadUrl: 'https://s/1' }],
  }) as unknown as Awaited<ReturnType<typeof transfers.resolveDownloads>>

const spies: { mockRestore: () => void }[] = []

beforeEach(async () => {
  memory = portabilityDb()
  await agentMessages().insertOne({
    sessionId: 'chat',
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
})

afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore()
})

test('a post stores only a finished upload of the poster, with the store’s file list', async () => {
  const get = spyOn(transfers, 'getTransferGroup').mockResolvedValue(group('ready'))

  spies.push(get)
  expect(await channelUploadPart(TEAM, 'mei', 'g1')).toEqual({
    type: 'transfer-upload',
    groupId: 'g1',
    status: 'ready',
    files: [{ fileName: 'shot.png', size: 42, status: 'ready' }],
  })
  expect(get.mock.calls[0]![0]).toMatchObject({ userId: 'mei' })
  get.mockResolvedValue(group('pending'))
  await expect(channelUploadPart(TEAM, 'mei', 'g1')).rejects.toThrow('not finished')
})

test('an upload resolves through the chat it was posted to, under its uploader', async () => {
  const resolve = spyOn(transfers, 'resolveDownloads').mockResolvedValue(group('ready'))

  spies.push(resolve)
  expect((await resolveChannelFiles(channel, 'g1')).files).toHaveLength(1)
  expect(resolve.mock.calls[0]![0]).toMatchObject({ userId: 'mei' })
  // A group never posted here finds nothing, whoever uploaded it.
  await expect(resolveChannelFiles(channel, 'other')).rejects.toThrow('Attachment not found')
  await expect(resolveChannelFiles({ ...channel, sessionId: 'elsewhere' }, 'g1')).rejects.toThrow(
    'Attachment not found',
  )
})

test('an agent’s pushed files resolve under its owner, through the chat it posted them to', async () => {
  await agentConversations().insertOne({
    sessionId: 'agent-a',
    userId: 'agent-owner',
    teamId: TEAM,
  } as never)
  await agentMessages().insertOne({
    sessionId: 'chat',
    userId: 'owner',
    index: 1,
    messageId: 'm2',
    role: 'user',
    parts: [{ type: 'transfer-download', groupId: 'd1' }],
    metadata: {
      version: 1,
      sender: { type: 'agent', id: 'agent-a', displayName: 'Docs writer' },
      source: 'agent.thread',
      sourceSessionId: 'agent-a',
      sentAt: new Date().toISOString(),
    },
  } as never)
  const resolve = spyOn(transfers, 'resolveDownloads').mockResolvedValue(group('ready'))

  spies.push(resolve)
  await resolveChannelFiles(channel, 'd1')
  expect(resolve.mock.calls[0]![0]).toMatchObject({ userId: 'agent-owner' })
})
