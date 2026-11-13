import { beforeEach, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import { agentConversations, agentMessages } from './db'
import { listChannelMentions } from './db/channel-mentions'
import { localRuntimeId } from './devices/local-runtime/address'
import { attributeAppMessages } from './message-attribution'

import type * as dbActual from '@/lib/db'
import type { UIMessage } from 'ai'

const TEAM = 'team'
let memory = portabilityDb()

useDb({ db: (() => memory) as unknown as typeof dbActual.db })
useIdentity({
  getTeamMembers: async () =>
    [
      { id: 'owner', name: 'Owner' },
      { id: 'daniel', name: '', email: 'daniel@example.com' },
      { id: 'outsider', name: 'Outsider' },
    ] as never,
})

beforeEach(async () => {
  memory = portabilityDb()
  await agentConversations().insertOne({
    sessionId: 'session',
    userId: 'owner',
    teamId: TEAM,
    title: 'Plan',
    firstMessage: '',
    participantIds: ['daniel'],
  } as never)
})

function said(text: string, mentions?: unknown): UIMessage[] {
  return [
    {
      id: 'm1',
      role: 'user',
      parts: [{ type: 'text', text }],
      ...(mentions ? { metadata: { mentions } } : {}),
    },
  ] as UIMessage[]
}

/** The Inbox entry is written after the send returns, so wait for it. */
async function inboxOf(userId: string) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const found = await listChannelMentions(TEAM, userId)

    if (found.length > 0) return found
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  return []
}

test('a mention chip in an agent conversation becomes trusted metadata and an Inbox entry', async () => {
  const messages = said('@daniel@example.com have you seen this?', [
    { id: 'daniel', displayName: 'Daniel (spoofed)' },
    'nobody',
  ])

  await attributeAppMessages(
    messages,
    'session',
    'owner',
    'owner',
    false,
    undefined,
    undefined,
    TEAM,
  )

  expect(messages[0]?.metadata).toMatchObject({
    sender: { id: 'owner' },
    mentions: [{ id: 'daniel', displayName: 'daniel@example.com' }],
  })
  // The client's claim never survives as is: not its names, not ids outside the team.
  expect(JSON.stringify(messages[0]?.metadata)).not.toMatch(/nobody|spoofed/)
  await agentMessages().insertOne({
    sessionId: 'session',
    userId: 'owner',
    index: 0,
    messageId: 'm1',
    role: 'user',
    parts: messages[0]?.parts,
    metadata: messages[0]?.metadata,
  } as never)
  expect(await inboxOf('daniel')).toMatchObject([
    { channelId: 'session', kind: 'agent', messageId: 'm1', sender: { id: 'owner' } },
  ])
})

test('someone outside the conversation gets the chip but no Inbox entry', async () => {
  const messages = said('@Outsider look', ['outsider'])

  await attributeAppMessages(
    messages,
    'session',
    'owner',
    'owner',
    false,
    undefined,
    undefined,
    TEAM,
  )

  expect(messages[0]?.metadata).toMatchObject({
    mentions: [{ id: 'outsider', displayName: 'Outsider' }],
  })
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect((await agentConversations().findOne({ sessionId: 'session' }))?.mentions).toBeUndefined()
})

test('someone who cannot use the computer it runs on gets no Inbox entry', async () => {
  // The owner's own computer, which the mentioned teammate has no use of.
  await agentConversations().updateOne(
    { sessionId: 'session' },
    {
      $set: { runtimeId: localRuntimeId({ userId: 'owner', deviceId: 'mac', provider: 'codex' }) },
    },
  )
  const messages = said('@daniel@example.com fyi', ['daniel'])

  await attributeAppMessages(
    messages,
    'session',
    'owner',
    'owner',
    false,
    undefined,
    undefined,
    TEAM,
  )
  await new Promise((resolve) => setTimeout(resolve, 50))

  expect(messages[0]?.metadata).toMatchObject({ mentions: [{ id: 'daniel' }] })
  expect((await agentConversations().findOne({ sessionId: 'session' }))?.mentions).toBeUndefined()
  // Nor does an entry recorded before they lost it list.
  await agentConversations().updateOne(
    { sessionId: 'session' },
    { $set: { mentions: { daniel: { messageId: 'm1', at: new Date() } } } },
  )
  await agentMessages().insertOne({
    sessionId: 'session',
    userId: 'owner',
    index: 0,
    messageId: 'm1',
    role: 'user',
    parts: [{ type: 'text', text: 'hi' }],
  } as never)
  expect(await listChannelMentions(TEAM, 'daniel')).toEqual([])
})
