import { afterEach, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { AppError } from '@/lib/errors'
import { useDb } from '@/lib/test/doubles/db'

const ADMIN = new ObjectId().toHexString()
const EDITOR = new ObjectId().toHexString()
const TEAM = new ObjectId().toHexString()
const triggerId = new ObjectId()
const MISSING_GRAFANA = new ObjectId().toHexString()
const MISSING_BETTERSTACK = new ObjectId().toHexString()
// Still bound, but its token cannot be used, so any cleanup attempt fails
// with an ordinary provider error before reaching the network.
const CONNECTED_GRAFANA = new ObjectId()

function grafanaWiring(integrationId: string) {
  return {
    provider: 'grafana',
    integrationId,
    alertRuleUid: 'rule-1',
    contactPointUid: 'cp-1',
    contactPointName: 'nuphos-watch',
    labelKey: 'nuphos_watch',
    labelValue: triggerId.toHexString(),
    routingMode: 'policy',
  }
}

const baseTrigger = {
  _id: triggerId,
  userId: ADMIN,
  teamId: TEAM,
  executionPrincipalUserId: ADMIN,
  name: 'CPU alert',
  messageTemplate: 'Investigate the alert',
  triggerType: 'webhook',
  enabled: false,
  configRevision: 3,
  cleanupStatus: 'cleanup_failed',
  cleanupError: 'The Grafana integration used by this Watch is no longer connected',
  cleanupErrorCode: 'provider_integration_disconnected',
  providerWiring: grafanaWiring(MISSING_GRAFANA),
  createdAt: new Date(),
  updatedAt: new Date(),
}

let stored: Record<string, unknown> | null = null
// Simulates another request claiming the row between our read and our claim.
let claimedConcurrently = false
const triggerWrites: string[] = []

function matches(row: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  if ('cleanupStatus' in filter) {
    const expected = filter.cleanupStatus

    if (typeof expected === 'string' ? row.cleanupStatus !== expected : 'cleanupStatus' in row) {
      return false
    }
  }

  return typeof filter.configRevision !== 'number' || row.configRevision === filter.configRevision
}

const triggers = {
  findOne: () => Promise.resolve(stored ? { ...stored } : null),
  updateOne: (
    filter: Record<string, unknown>,
    update: {
      $set?: Record<string, unknown>
      $unset?: Record<string, unknown>
      $inc?: Record<string, number>
    },
  ) => {
    if (claimedConcurrently && stored) stored.configRevision = 99
    if (!stored || !matches(stored, filter)) {
      return Promise.resolve({ matchedCount: 0, modifiedCount: 0 })
    }
    triggerWrites.push('update')
    Object.assign(stored, update.$set)
    for (const key of Object.keys(update.$unset ?? {})) delete stored[key]
    for (const [key, by] of Object.entries(update.$inc ?? {})) {
      stored[key] = ((stored[key] as number | undefined) ?? 0) + by
    }

    return Promise.resolve({ matchedCount: 1, modifiedCount: 1 })
  },
  deleteOne: (filter: Record<string, unknown>) => {
    if (!stored || !matches(stored, filter)) return Promise.resolve({ deletedCount: 0 })
    triggerWrites.push('delete')
    stored = null

    return Promise.resolve({ deletedCount: 1 })
  },
}

const rows: Record<string, unknown> = {
  teams: {
    _id: new ObjectId(TEAM),
    name: 'Team',
    ownerID: new ObjectId(ADMIN),
    contactEmails: [],
    createdAt: new Date(),
    members: [
      { userId: new ObjectId(ADMIN), role: 'ADMINISTRATOR', joinedAt: new Date() },
      { userId: new ObjectId(EDITOR), role: 'EDITOR', joinedAt: new Date() },
    ],
  },
  team_byos_bindings: {
    _id: new ObjectId(TEAM),
    grafanaInstances: [
      {
        id: CONNECTED_GRAFANA,
        grafanaUrl: 'https://grafana.invalid',
        encryptedToken: 'not-a-valid-ciphertext',
      },
    ],
    betterStackIntegrations: [],
  },
}

function collection(name: string) {
  if (name === 'agent_triggers') return triggers

  return {
    findOne: () => Promise.resolve(rows[name] ?? null),
    updateOne: () => Promise.resolve({ matchedCount: 0, modifiedCount: 0 }),
    updateMany: () => Promise.resolve({ matchedCount: 0, modifiedCount: 0 }),
    deleteMany: () => Promise.resolve({ deletedCount: 0 }),
    find: () => ({ toArray: () => Promise.resolve([]) }),
  }
}

useDb({ db: () => ({ collection }) as never })

const { deleteTrigger } = await import('./delete')

const admin = { userId: ADMIN, teamId: TEAM }
const force = { withoutProviderCleanup: true }

function load(overrides: Record<string, unknown> = {}) {
  stored = { ...baseTrigger, ...overrides }
}

async function failure(run: Promise<unknown>): Promise<AppError> {
  try {
    await run
  } catch (err) {
    if (err instanceof AppError) return err
    throw err
  }
  throw new Error('expected the request to fail')
}

afterEach(() => {
  stored = null
  claimedConcurrently = false
  triggerWrites.length = 0
})

describe('normal removal of a Watch whose integration is gone', () => {
  test('records the distinct disconnected code on the failed row', async () => {
    load({ cleanupStatus: undefined, cleanupError: undefined, cleanupErrorCode: undefined })
    delete stored!.cleanupStatus

    const err = await failure(deleteTrigger(triggerId.toHexString(), admin))

    expect(err.code).toBe('provider_integration_disconnected')
    expect(stored?.cleanupStatus).toBe('cleanup_failed')
    expect(stored?.cleanupErrorCode).toBe('provider_integration_disconnected')
  })

  test('keeps the generic code when the integration is connected but cleanup fails', async () => {
    load({ providerWiring: grafanaWiring(CONNECTED_GRAFANA.toHexString()) })

    const err = await failure(deleteTrigger(triggerId.toHexString(), admin))

    expect(err.code).not.toBe('provider_integration_disconnected')
    expect(stored?.cleanupStatus).toBe('cleanup_failed')
    expect(stored?.cleanupErrorCode).toBe(err.code)
  })
})

describe('removing without provider cleanup', () => {
  test('is refused unless cleanup has failed, without writing', async () => {
    load()
    delete stored!.cleanupStatus

    const err = await failure(deleteTrigger(triggerId.toHexString(), admin, force))

    expect(err.code).toBe('trigger_cleanup_not_failed')
    expect(triggerWrites).toEqual([])
  })

  test('is refused for a role that cannot delete, without writing', async () => {
    load()

    const err = await failure(
      deleteTrigger(triggerId.toHexString(), { userId: EDITOR, teamId: TEAM }, force),
    )

    expect(err.status).toBe(403)
    expect(triggerWrites).toEqual([])
    expect(stored?.cleanupStatus).toBe('cleanup_failed')
  })

  test('leaves the disconnected provider behind and removes the Watch', async () => {
    load()

    const result = await deleteTrigger(triggerId.toHexString(), admin, force)

    expect(result).toEqual({ deleted: true, leftBehind: ['grafana'] })
    expect(stored).toBeNull()
  })

  test('cleans normally when the integration was reconnected: nothing is skipped', async () => {
    // The stored code still says disconnected, but a fresh lookup finds the
    // binding, so provider cleanup runs and its failure keeps the Watch.
    load({ providerWiring: grafanaWiring(CONNECTED_GRAFANA.toHexString()) })

    const err = await failure(deleteTrigger(triggerId.toHexString(), admin, force))

    expect(err.code).not.toBe('provider_integration_disconnected')
    expect(stored?.cleanupStatus).toBe('cleanup_failed')
    expect(triggerWrites).not.toContain('delete')
  })

  test('in a Watch Group, skips every disconnected provider and still removes the Watch', async () => {
    load({
      providerWiring: {
        provider: 'watch_group',
        wirings: [
          grafanaWiring(MISSING_GRAFANA),
          { provider: 'betterstack', integrationId: MISSING_BETTERSTACK, outgoingWebhookId: 'w1' },
        ],
      },
    })

    const result = await deleteTrigger(triggerId.toHexString(), admin, force)

    expect(result).toEqual({ deleted: true, leftBehind: ['grafana', 'betterstack'] })
    expect(stored).toBeNull()
  })

  test('in a Watch Group, a reachable provider that fails still keeps the Watch', async () => {
    load({
      providerWiring: {
        provider: 'watch_group',
        wirings: [grafanaWiring(MISSING_GRAFANA), grafanaWiring(CONNECTED_GRAFANA.toHexString())],
      },
    })

    const err = await failure(deleteTrigger(triggerId.toHexString(), admin, force))

    expect(err.code).not.toBe('provider_integration_disconnected')
    expect(stored?.cleanupStatus).toBe('cleanup_failed')
  })

  test('a legacy Watch whose provider has no integration left is removed', async () => {
    load({ providerWiring: undefined, legacyMonitoringProvider: 'betterstack' })
    delete stored!.providerWiring

    const result = await deleteTrigger(triggerId.toHexString(), admin, force)

    expect(result).toEqual({ deleted: true, leftBehind: ['betterstack'] })
    expect(stored).toBeNull()
  })

  test('loses cleanly to a concurrent retry that claimed the Watch first', async () => {
    load()
    claimedConcurrently = true

    const err = await failure(deleteTrigger(triggerId.toHexString(), admin, force))

    expect(err.code).toBe('trigger_changed')
    expect(triggerWrites).toEqual([])
  })
})
