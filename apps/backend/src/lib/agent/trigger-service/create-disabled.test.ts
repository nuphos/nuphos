import { beforeEach, expect, test } from 'bun:test'

import { ObjectId } from 'mongodb'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useTriggerScheduler } from '@/lib/test/doubles/trigger-scheduler'

import { createTrigger } from './create'

const scheduled: unknown[][] = []
const documents: Record<string, unknown>[] = []
const userId = 'fixture-owner'
const teamId = 'aaaaaaaaaaaaaaaaaaaaaaaa'

useIdentity({ getTeamMembership: async () => ({ role: 'ADMINISTRATOR' }) })
useAgentDb({ getConversationBySessionId: async () => ({ userId, teamId }) })
useTriggerScheduler({
  scheduleCronTrigger: async (...args) => {
    scheduled.push(args)
  },
})
useDb({
  db: () => ({
    collection: () => ({
      insertOne: async (doc: Record<string, unknown>) => {
        documents.push(doc)

        return { insertedId: new ObjectId() }
      },
      countDocuments: async () => 0,
    }),
  }),
})
beforeEach(() => {
  scheduled.length = 0
  documents.length = 0
})

test('an imported disabled Trigger is stored without registering any cron job', async () => {
  const created = await createTrigger(
    {
      name: 'Imported digest',
      triggerType: 'cron',
      targetSessionId: 'fixture-session',
      messageTemplate: 'Prepare a digest',
      cronExpression: '0 9 * * *',
      timeZone: 'Europe/Warsaw',
      enabled: false,
    },
    { userId, teamId, source: 'user', credentialMode: 'all' },
  )

  expect(created.enabled).toBe(false)
  expect(created.timeZone).toBe('Europe/Warsaw')
  expect(documents).toHaveLength(1)
  expect(scheduled).toEqual([])
})

test('invalid imported time zones fail before writing a Trigger', async () => {
  await expect(
    createTrigger(
      {
        name: 'Digest',
        triggerType: 'cron',
        targetSessionId: 'fixture-session',
        messageTemplate: 'Prepare a digest',
        cronExpression: '0 9 * * *',
        timeZone: 'Invalid/Zone',
        enabled: false,
      },
      { userId, teamId, source: 'user', credentialMode: 'all' },
    ),
  ).rejects.toThrow()
  expect(documents).toEqual([])
  expect(scheduled).toEqual([])
})
