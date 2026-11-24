// A Bot nested under another Bot stays a Bot: it is never part of the other's subtree.
// Runs when TEST_MONGODB_URI is set, with MONGODB_URI pointing at the same server.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { closeDb, connectDb } from '@/lib/db'
import { useIdentity } from '@/lib/test/doubles/identity'

import { cleanUpArchived } from './archive-cleanup'
import { setConversationArchived } from './db/archive'
import { credentialHeirs, credentialSourceOf } from './db/credential-source'
import { agentConversations } from './db/shared'
import { agentTriggers } from './trigger-db'
import { triggerHistory } from './trigger-history'

useIdentity({ getTeamMembership: () => Promise.resolve({ role: 'ADMINISTRATOR' }) })

const owner = randomUUID()
const team = randomUUID()
const id = (name: string) => `${team}-${name}`
const now = new Date(Date.now() - 1000)
const row = (name: string, extra: Record<string, unknown> = {}) => ({
  sessionId: id(name),
  userId: owner,
  teamId: team,
  title: name,
  firstMessage: '',
  messageCount: 0,
  createdAt: now,
  lastActiveAt: now,
  ...extra,
})
const selection = (name: string) => ({ mode: 'selected', selected: [{ provider: name }] })
const read = (name: string) => agentConversations().findOne({ sessionId: id(name) })

describe.skipIf(!process.env.TEST_MONGODB_URI)('a Bot nested under another Bot', () => {
  beforeAll(async () => {
    await connectDb()
    await agentConversations().insertMany([
      row('lead', { avatar: '07-ada', credentialAccess: selection('lead') }),
      row('lead-task', { parentSessionId: id('lead') }),
      row('helper', {
        avatar: '02-leonardo',
        parentSessionId: id('lead'),
        credentialAccess: selection('helper'),
      }),
      row('helper-task', { parentSessionId: id('helper') }),
    ] as never)
    await agentTriggers().insertOne({
      _id: new ObjectId(),
      userId: owner,
      teamId: team,
      targetSessionId: id('helper'),
      name: 'Fictional',
      triggerType: 'webhook',
      messageTemplate: 'fixture',
      enabled: true,
      createdAt: now,
      updatedAt: now,
    } as never)
  })
  afterAll(async () => {
    await agentTriggers().deleteMany({ teamId: team })
    await agentConversations().deleteMany({ teamId: team })
    await triggerHistory().deleteMany({ teamId: team })
    await closeDb()
  })

  test('uses its own credentials, and its Tasks use its credentials', async () => {
    expect((await credentialSourceOf(id('helper')))?.sessionId).toBe(id('helper'))
    expect((await credentialSourceOf(id('helper-task')))?.sessionId).toBe(id('helper'))
    expect((await credentialSourceOf(id('lead-task')))?.sessionId).toBe(id('lead'))
    expect(await credentialHeirs({ sessionId: id('lead'), userId: owner, teamId: team })).toEqual([
      id('lead'),
      id('lead-task'),
    ])
  })

  test('stays, with its Tasks, Triggers and home, when the other Bot is archived', async () => {
    const { sessionIds } = await setConversationArchived(id('lead'), true, { source: 'user', userId: owner })

    await cleanUpArchived(sessionIds)
    expect((await read('lead'))?.archivedAt).toBeDefined()
    expect((await read('lead-task'))?.archivedAt).toBeDefined()
    for (const name of ['helper', 'helper-task']) {
      const conversation = await read(name)

      expect(conversation?.archivedAt).toBeUndefined()
      expect(conversation?.archiveHomePendingEpochs).toBeUndefined()
    }
    expect(await agentTriggers().countDocuments({ targetSessionId: id('helper') })).toBe(1)
  })
})
