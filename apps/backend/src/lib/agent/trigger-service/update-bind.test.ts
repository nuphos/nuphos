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

const conversations: Record<string, unknown> = {
  'bound-session': { sessionId: 'bound-session', userId: OWNER, teamId: TEAM },
  'someone-elses': {
    sessionId: 'someone-elses',
    userId: new ObjectId().toHexString(),
    teamId: TEAM,
  },
  'other-team': { sessionId: 'other-team', userId: OWNER, teamId: new ObjectId().toHexString() },
}
let storedTrigger: Record<string, unknown> = legacyTrigger

const rows: Record<string, unknown> = {
  teams: {
    _id: new ObjectId(TEAM),
    name: 'Team',
    ownerID: new ObjectId(OWNER),
    contactEmails: [],
    createdAt: new Date(),
    members: [{ userId: new ObjectId(OWNER), role: 'ADMINISTRATOR', joinedAt: new Date() }],
  },
}

function collection(name: string) {
  return {
    findOne: (filter: { sessionId?: string }) =>
      Promise.resolve(
        name === 'agent_conversations'
          ? (conversations[filter.sessionId ?? ''] ?? null)
          : name === 'agent_triggers'
            ? storedTrigger
            : (rows[name] ?? null),
      ),
    countDocuments: () => Promise.resolve(0),
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
const { createTrigger } = await import('./create')

afterEach(() => {
  writes.length = 0
  storedTrigger = legacyTrigger
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

describe('re-creating a Trigger with the same dedupeKey', () => {
  const input = {
    name: 'CPU alert',
    triggerType: 'webhook' as const,
    messageTemplate: 'Investigate the alert',
    targetSessionId: 'bound-session',
    dedupeKey: 'import:cpu',
  }
  const ctx = { userId: OWNER, teamId: TEAM, source: 'user' as const }

  test('returns the existing Trigger without writing', async () => {
    storedTrigger = { ...legacyTrigger, targetSessionId: 'bound-session', dedupeKey: 'import:cpu' }

    const existing = await createTrigger(input, ctx)

    expect(existing.id).toBe(triggerId.toHexString())
    expect(writes.filter((entry) => entry.collection === 'agent_triggers')).toHaveLength(0)
  })

  test('refuses a key already used by a Trigger bound to another conversation', async () => {
    storedTrigger = { ...legacyTrigger, targetSessionId: 'other-session', dedupeKey: 'import:cpu' }

    await expect(createTrigger(input, ctx)).rejects.toMatchObject({
      code: 'trigger_dedupe_conflict',
    })
  })
})

describe('turning a Trigger on', () => {
  const disabledUnbound = { ...legacyTrigger, enabled: false }
  const triggerWrite = () => writes.find((entry) => entry.collection === 'agent_triggers')

  test('refuses an unbound Trigger without a conversation, and writes nothing', async () => {
    storedTrigger = disabledUnbound

    await expect(
      updateTrigger(triggerId.toHexString(), OWNER, { enabled: true }),
    ).rejects.toMatchObject({ status: 400, code: 'trigger_target_session_required' })
    expect(triggerWrite()).toBeUndefined()
  })

  test('enables an unbound Trigger together with its owner’s conversation', async () => {
    storedTrigger = disabledUnbound

    const updated = await updateTrigger(triggerId.toHexString(), OWNER, {
      enabled: true,
      targetSessionId: 'bound-session',
    })

    expect(updated.enabled).toBe(true)
    expect(updated.targetSessionId).toBe('bound-session')
    expect(triggerWrite()?.update.$set).toMatchObject({
      enabled: true,
      targetSessionId: 'bound-session',
    })
  })

  test.each(['someone-elses', 'other-team', 'missing'])(
    'refuses to enable it into a %s conversation',
    async (targetSessionId) => {
      storedTrigger = disabledUnbound

      await expect(
        updateTrigger(triggerId.toHexString(), OWNER, { enabled: true, targetSessionId }),
      ).rejects.toMatchObject({ status: 400 })
      expect(triggerWrite()).toBeUndefined()
    },
  )

  test('still enables a Trigger that is already bound', async () => {
    storedTrigger = { ...disabledUnbound, targetSessionId: 'bound-session' }

    const updated = await updateTrigger(triggerId.toHexString(), OWNER, { enabled: true })

    expect(updated.enabled).toBe(true)
  })

  test('still disables an unbound Trigger', async () => {
    const updated = await updateTrigger(triggerId.toHexString(), OWNER, { enabled: false })

    expect(updated.enabled).toBe(false)
  })

  test('still renames a disabled unbound Trigger', async () => {
    storedTrigger = disabledUnbound

    const updated = await updateTrigger(triggerId.toHexString(), OWNER, { name: 'Renamed' })

    expect(updated.name).toBe('Renamed')
    expect(updated.enabled).toBe(false)
  })

  test('refuses other edits to an enabled unbound row until it is bound or disabled', async () => {
    await expect(
      updateTrigger(triggerId.toHexString(), OWNER, { name: 'Renamed' }),
    ).rejects.toMatchObject({ status: 400, code: 'trigger_target_session_required' })
    expect(triggerWrite()).toBeUndefined()
  })
})
