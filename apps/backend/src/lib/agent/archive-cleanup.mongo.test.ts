import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { closeDb, connectDb, mongo } from '@/lib/db'
import { useIdentity } from '@/lib/test/doubles/identity'

import { cleanUpArchived, retryArchivedTaskTriggers } from './archive-cleanup'
import { setConversationArchived } from './db/archive'
import { agentConversations } from './db/shared'
import { agentTriggers } from './trigger-db'
import { triggerHistory } from './trigger-history'
import { createTrigger } from './trigger-service/create'

useIdentity({ getTeamMembership: async () => ({ role: 'ADMINISTRATOR' }) })

const owner = randomUUID()
const team = randomUUID()
const target = randomUUID()
const control = randomUUID()
const ids = [new ObjectId(), new ObjectId(), new ObjectId()]
const now = new Date(Date.now() - 1000)

// What the archive routes do: archive, then clean up what it queued.
const archiveTask = async (sessionId: string) => {
  await setConversationArchived(sessionId, true, { source: 'user' })
  await cleanUpArchived([sessionId])
}

describe.skipIf(!process.env.TEST_MONGODB_URI)('archiving cleans Task Triggers in MongoDB', () => {
  beforeAll(async () => {
    await connectDb()
    for (const sessionId of [target, control])
      await agentConversations().insertOne({
        sessionId,
        userId: owner,
        teamId: team,
        title: 'Fictional',
        firstMessage: '',
        messageCount: 0,
        createdAt: now,
        lastActiveAt: now,
      })
    for (const [index, id] of ids.entries())
      await agentTriggers().insertOne({
        _id: id,
        userId: owner,
        teamId: team,
        targetSessionId: index === 2 ? control : target,
        name: 'Fictional',
        triggerType: 'webhook',
        messageTemplate: 'fixture',
        enabled: index !== 1,
        createdAt: now,
        updatedAt: now,
      })
  })
  afterAll(async () => {
    await agentTriggers().deleteMany({ teamId: team })
    await agentConversations().deleteMany({ teamId: team })
    await triggerHistory().deleteMany({ teamId: team })
    await closeDb()
  })
  test('deletes both enabled and disabled Triggers, retains the other Task and records deletion', async () => {
    await archiveTask(target)
    expect((await agentConversations().findOne({ sessionId: target }))?.archivedAt).toBeDefined()
    expect(await agentTriggers().countDocuments({ targetSessionId: target })).toBe(0)
    expect(await agentTriggers().countDocuments({ targetSessionId: control })).toBe(1)
    expect(await triggerHistory().countDocuments({ teamId: team, action: 'deleted' })).toBe(2)
    await archiveTask(target)
    expect(await triggerHistory().countDocuments({ teamId: team, action: 'deleted' })).toBe(2)
  })
  test('a pending archive cleanup retries after restore without deleting a later Trigger', async () => {
    const cutoff = new Date()
    const oldId = new ObjectId()
    const newId = new ObjectId()
    const trigger = {
      userId: owner,
      teamId: team,
      targetSessionId: target,
      name: 'Fictional',
      triggerType: 'webhook' as const,
      messageTemplate: 'fixture',
      enabled: true,
      updatedAt: cutoff,
    }

    await agentTriggers().insertMany([
      { ...trigger, _id: oldId, archiveEpoch: 0, createdAt: new Date(cutoff.getTime() - 1000) },
      { ...trigger, _id: newId, archiveEpoch: 1, createdAt: new Date(cutoff.getTime() + 1000) },
    ])
    await agentConversations().updateOne(
      { sessionId: target },
      {
        $unset: { archivedAt: '' },
        $set: { archiveTriggersPendingAt: cutoff, triggerArchiveEpoch: 1 },
      },
    )
    await retryArchivedTaskTriggers()
    expect(await agentTriggers().findOne({ _id: oldId })).toBeNull()
    expect(await agentTriggers().findOne({ _id: newId })).not.toBeNull()
    expect(
      (await agentConversations().findOne({ sessionId: target }))?.archiveTriggersPendingAt,
    ).toBeUndefined()
  })

  test('a restored Task rejects Trigger creation until pending cleanup, and a new Trigger sorts after the archive even within one tick', async () => {
    const sessionId = randomUUID()
    const cutoff = new Date()

    await agentConversations().insertOne({
      sessionId,
      userId: owner,
      teamId: team,
      title: 'Fictional',
      firstMessage: '',
      messageCount: 0,
      createdAt: now,
      lastActiveAt: now,
      archiveRestoredAt: cutoff,
      archiveTriggersPendingAt: cutoff,
      triggerArchiveEpoch: 1,
    })
    const input = {
      name: 'Fictional',
      triggerType: 'webhook' as const,
      targetSessionId: sessionId,
      messageTemplate: 'fixture',
      enabled: false,
    }
    const actor = {
      userId: owner,
      teamId: team,
      source: 'user' as const,
      credentialMode: 'all' as const,
    }

    await expect(createTrigger(input, actor)).rejects.toMatchObject({
      code: 'invalid_target_session',
    })
    expect(await agentTriggers().countDocuments({ targetSessionId: sessionId })).toBe(0)
    await agentConversations().updateOne(
      { sessionId },
      { $unset: { archiveTriggersPendingAt: '' } },
    )
    const created = await createTrigger(input, actor)
    const row = await agentTriggers().findOne({ _id: new ObjectId(created.id) })

    expect(row?.archiveEpoch).toBe(1)
  })

  test('archive includes a concurrent creation whose recorded time exceeds the sampled cutoff', async () => {
    const sessionId = randomUUID()
    const triggerId = new ObjectId()

    await agentConversations().insertOne({
      sessionId,
      userId: owner,
      teamId: team,
      title: 'Fictional',
      firstMessage: '',
      messageCount: 0,
      createdAt: now,
      lastActiveAt: now,
    })
    const txn = mongo.startSession()

    txn.startTransaction()
    try {
      await agentConversations().updateOne(
        { sessionId },
        { $set: { triggerBindingFence: randomUUID() } },
        { session: txn },
      )
      const archive = archiveTask(sessionId)

      await new Promise((resolve) => setTimeout(resolve, 30))
      const createdAt = new Date(Date.now() + 1000)

      await agentTriggers().insertOne(
        {
          _id: triggerId,
          userId: owner,
          teamId: team,
          targetSessionId: sessionId,
          name: 'Fictional',
          triggerType: 'webhook',
          messageTemplate: 'fixture',
          enabled: false,
          createdAt,
          updatedAt: createdAt,
        },
        { session: txn },
      )
      await txn.commitTransaction()
      await archive
      expect(await agentTriggers().findOne({ _id: triggerId })).toBeNull()
    } finally {
      if (txn.inTransaction()) await txn.abortTransaction()
      await txn.endSession()
    }
  })

  test('archive waits for a concurrent Trigger creation transaction and removes its Trigger', async () => {
    const sessionId = randomUUID()
    const triggerId = new ObjectId()

    await agentConversations().insertOne({
      sessionId,
      userId: owner,
      teamId: team,
      title: 'Fictional',
      firstMessage: '',
      messageCount: 0,
      createdAt: now,
      lastActiveAt: now,
    })
    const txn = mongo.startSession()

    txn.startTransaction()
    try {
      await agentConversations().updateOne(
        { sessionId },
        { $set: { triggerBindingFence: randomUUID() } },
        { session: txn },
      )
      const archive = archiveTask(sessionId)

      await new Promise((resolve) => setTimeout(resolve, 30))
      await agentTriggers().insertOne(
        {
          _id: triggerId,
          userId: owner,
          teamId: team,
          targetSessionId: sessionId,
          name: 'Fictional',
          triggerType: 'webhook',
          messageTemplate: 'fixture',
          enabled: false,
          createdAt: now,
          updatedAt: now,
        },
        { session: txn },
      )
      await txn.commitTransaction()
      await archive
      expect((await agentConversations().findOne({ sessionId }))?.archivedAt).toBeDefined()
      expect(await agentTriggers().findOne({ _id: triggerId })).toBeNull()
    } finally {
      if (txn.inTransaction()) await txn.abortTransaction()
      await txn.endSession()
    }
  })
})
