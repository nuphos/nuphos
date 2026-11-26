import { beforeEach, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useTriggerScheduler } from '@/lib/test/doubles/trigger-scheduler'

import { createTrigger } from './create'

const documents: Record<string, unknown>[] = []
const userId = 'fixture-owner'
const teamId = 'aaaaaaaaaaaaaaaaaaaaaaaa'

useIdentity({ getTeamMembership: async () => ({ role: 'ADMINISTRATOR' }) })
useAgentDb({ getConversationBySessionId: async () => ({ userId, teamId }) })
useTriggerScheduler({ scheduleCronTrigger: async () => {} })
useDb({
  withTransaction: (body: (session: never) => Promise<void>) => body({} as never),
  db: () => ({
    collection: (name: string) => ({
      insertOne: async (doc: Record<string, unknown>) => {
        if (name === 'agent_triggers') documents.push(doc)

        return { insertedId: new ObjectId() }
      },
      // The owner already has 50 enabled Triggers; the team is well under its own limit.
      countDocuments: async () => 50,
      findOne: async () => (name === 'agent_conversations' ? { userId, teamId } : null),
      updateOne: async () => ({ matchedCount: 1 }),
    }),
  }),
})
beforeEach(() => {
  documents.length = 0
})

const input = {
  name: 'Nightly',
  triggerType: 'cron' as const,
  targetSessionId: 'fixture-session',
  messageTemplate: 'Run the nightly check',
  cronExpression: '0 3 * * *',
}

test('an owner with 50 enabled Triggers in a team can create a 51st', async () => {
  const created = await createTrigger(input, {
    userId,
    teamId,
    source: 'user',
    credentialMode: 'all',
  })

  expect(created.enabled).toBe(true)
  expect(documents).toHaveLength(1)
})
