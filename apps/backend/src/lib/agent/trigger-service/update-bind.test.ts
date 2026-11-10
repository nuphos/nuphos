import { afterEach, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useDb } from '@/lib/test/doubles/db'

const OWNER = new ObjectId().toHexString()
const TEAM = new ObjectId().toHexString()
const triggerId = new ObjectId()
const writes: { collection: string; update: Record<string, Record<string, unknown>> }[] = []

// Created before binding was required: unbound, with incident delivery.
const legacyTrigger = {
  _id: triggerId,
  userId: OWNER,
  teamId: TEAM,
  executionPrincipalUserId: OWNER,
  name: 'CPU alert',
  messageTemplate: 'Investigate the alert',
  triggerType: 'webhook',
  incidentMode: true,
  slackDestination: { type: 'dm_self' },
  enabled: true,
  configRevision: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
}

const rows: Record<string, unknown> = {
  agent_conversations: { sessionId: 'bound-session', userId: OWNER, teamId: TEAM },
  agent_triggers: legacyTrigger,
}

function collection(name: string) {
  return {
    findOne: () => Promise.resolve(rows[name] ?? null),
    findOneAndUpdate: () => Promise.resolve(null),
    updateOne: (_filter: unknown, update: Record<string, Record<string, unknown>>) => {
      writes.push({ collection: name, update })

      return Promise.resolve({ matchedCount: 1, modifiedCount: 1 })
    },
    updateMany: () => Promise.resolve({ matchedCount: 0, modifiedCount: 0 }),
    deleteMany: () => Promise.resolve({ deletedCount: 0 }),
    find: () => ({ toArray: () => Promise.resolve([]) }),
  }
}

useDb({ db: () => ({ collection }) as never })

const { updateTrigger } = await import('./update')

afterEach(() => {
  writes.length = 0
})

describe('binding a legacy unbound Trigger', () => {
  test('stores the session and drops its fresh-session modes', async () => {
    const updated = await updateTrigger(triggerId.toHexString(), OWNER, {
      targetSessionId: 'bound-session',
    })

    expect(updated.targetSessionId).toBe('bound-session')
    expect(updated).not.toHaveProperty('incidentMode')
    expect(updated).not.toHaveProperty('slackDestination')

    const write = writes.find((entry) => entry.collection === 'agent_triggers')

    expect(write?.update.$set?.targetSessionId).toBe('bound-session')
    expect(write?.update.$unset).toEqual({ incidentMode: true, slackDestination: true })
  })
})
