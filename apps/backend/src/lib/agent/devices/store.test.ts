// Run with: cd apps/backend && bun test src/lib/agent/devices/store.test.ts

import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import type { LocalRuntimeStatus } from './local-runtime/protocol'
import type * as dbActual from '@/lib/db'

type Doc = Record<string, unknown>

type Push = { $each: Doc[]; $slice: number }

// One `$elemMatch` term on a pending entry's agent; `$exists: false` is the only operator.
const agentField = (entry: Doc, key: string, value: unknown) =>
  (entry.agent as Doc)[key.replace('agent.', '')] ===
  (typeof value === 'object' ? undefined : value)

// The operator filters the store uses: no added agent with that instance id yet, and no
// pending entry for that agent yet.
function matches(doc: Doc, [key, value]: [string, unknown]): boolean {
  if (key === 'removedAgents' || key === 'pendingResets') {
    const same = (value as { $not: { $elemMatch: Doc } }).$not.$elemMatch

    return !((doc[key] ?? []) as Doc[]).some((entry) =>
      Object.entries(same).every(([field, wanted]) => agentField(entry, field, wanted)),
    )
  }
  if (key !== 'addedAgents.instanceId') return doc[key] === value
  const ne = (value as { $ne: unknown }).$ne

  return !((doc.addedAgents ?? []) as Doc[]).some((entry) => entry.instanceId === ne)
}

// What the store asks of its collection, over plain objects.
class FakeCollection {
  docs: Doc[] = []

  findOne(filter: Doc) {
    return Promise.resolve(
      this.docs.find((doc) => Object.entries(filter).every((entry) => matches(doc, entry))) ?? null,
    )
  }
  async updateOne(
    filter: Doc,
    update: { $set?: Doc; $setOnInsert?: Doc; $push?: Record<string, Push | Doc>; $pull?: Doc },
    options?: { upsert?: boolean },
  ) {
    const hit = await this.findOne(filter)

    if (hit) Object.assign(hit, update.$set)
    else if (options?.upsert) this.docs.push({ ...filter, ...update.$set, ...update.$setOnInsert })
    for (const [field, push] of Object.entries(update.$push ?? {}))
      if (hit)
        hit[field] =
          '$each' in push
            ? [...((hit[field] ?? []) as Doc[]), ...(push as Push).$each].slice(
                (push as Push).$slice,
              )
            : [...((hit[field] ?? []) as Doc[]), push]
    for (const [field, pulled] of Object.entries(update.$pull ?? {})) {
      const id = (pulled as Doc).instanceId
      const drop = (value: unknown) =>
        typeof id === 'object' && id ? (id as { $in: unknown[] }).$in.includes(value) : value === id

      if (hit && field === 'addedAgents')
        hit[field] = ((hit[field] ?? []) as Doc[]).filter((entry) => !drop(entry.instanceId))
      else if (hit && 'id' in (pulled as Doc))
        hit[field] = ((hit[field] ?? []) as Doc[]).filter(
          (entry) => entry.id !== (pulled as Doc).id,
        )
      else if (hit && 'at' in (pulled as Doc)) {
        // The agent's entries older than `at.$lt`: an added agent's id, or a default's provider.
        const { at, ...agent } = pulled as Doc
        const named = (entry: Doc) =>
          Object.entries(agent).every(([path, want]) => {
            const value = (entry.agent as Doc)[path.split('.')[1] ?? '']

            return want && typeof want === 'object' ? value === undefined : value === want
          })

        hit[field] = ((hit[field] ?? []) as Doc[]).filter(
          (entry) => !(named(entry) && (entry.at as Date) < (at as { $lt: Date }).$lt),
        )
      }
    }

    return { matchedCount: hit ? 1 : 0 }
  }
}

const devices = new FakeCollection()

useDb({ db: (() => ({ collection: () => devices })) as unknown as typeof dbActual.db })

const { getAgentDevice, renameAgentDevice, upsertAgentDevice } = await import('./store')
const {
  forgetAgentReset,
  recordAgentAddition,
  recordAgentReset,
  retireAgentResets,
  recordDeviceAgents,
  removeDeviceAgent,
  renameDeviceAgent,
} = await import('./agent-registry-store')

const registration = {
  deviceId: 'mac-1',
  label: 'Yuanlin’s MacBook Pro',
  platform: 'darwin',
  allowLocalExec: true,
}

describe('agent device registration', () => {
  beforeEach(() => {
    devices.docs = []
  })

  test('a new device takes the label it reports', async () => {
    await upsertAgentDevice('u1', registration)
    expect((await getAgentDevice('u1', 'mac-1'))?.label).toBe('Yuanlin’s MacBook Pro')
  })

  test('a label chosen by the person survives the device registering again', async () => {
    await upsertAgentDevice('u1', registration)
    expect(await renameAgentDevice('u1', 'mac-1', 'Build Mac')).toBe(true)
    // Every Desktop launch and every host start registers with the machine's own name.
    await upsertAgentDevice('u1', { ...registration, platform: 'darwin', model: 'MacBook Pro' })
    const device = await getAgentDevice('u1', 'mac-1')

    expect(device?.label).toBe('Build Mac')
    expect(device?.model).toBe('MacBook Pro')
  })

  test('renaming a device the caller does not own changes nothing', async () => {
    await upsertAgentDevice('u1', registration)
    expect(await renameAgentDevice('u2', 'mac-1', 'Mine')).toBe(false)
    expect((await getAgentDevice('u1', 'mac-1'))?.label).toBe('Yuanlin’s MacBook Pro')
  })
})

describe('agent names', () => {
  const work = '11111111-1111-4111-8111-111111111111'
  const report = {
    agents: { 'claude-code': { cli: { installed: true, loggedIn: true } } },
    instances: [
      {
        instanceId: work,
        provider: 'claude-code',
        label: 'Claude Code',
        cli: { installed: true, loggedIn: true },
      },
    ],
  } as unknown as LocalRuntimeStatus

  beforeEach(async () => {
    devices.docs = []
    await upsertAgentDevice('u1', registration)
    await recordDeviceAgents('u1', 'mac-1', report)
  })

  test('a rename persists and the computer’s status reports never undo it', async () => {
    expect(await renameDeviceAgent('u1', 'mac-1', work, 'Review')).toBe(true)
    expect(await renameDeviceAgent('u1', 'mac-1', 'claude-code', 'Main')).toBe(true)
    await recordDeviceAgents('u1', 'mac-1', report)

    expect((await getAgentDevice('u1', 'mac-1'))?.agents).toEqual([
      { provider: 'claude-code', label: 'Main', signedIn: true },
      { provider: 'claude-code', instanceId: work, label: 'Review', signedIn: true },
    ])
  })

  test('an agent or device that is not registered is not renamed', async () => {
    expect(await renameDeviceAgent('u1', 'mac-1', 'codex', 'Mine')).toBe(false)
    expect(await renameDeviceAgent('u2', 'mac-1', work, 'Mine')).toBe(false)
  })
})

describe('who added an agent', () => {
  const work = '11111111-1111-4111-8111-111111111111'
  const first = { instanceId: work, userId: 'u2', at: new Date('2026-10-01T00:00:00Z') }

  beforeEach(async () => {
    devices.docs = []
    await upsertAgentDevice('u1', registration)
  })

  test('is kept once; a retry of the same agent never changes it', async () => {
    await recordAgentAddition('u1', 'mac-1', first)
    await recordAgentAddition('u1', 'mac-1', { ...first, userId: 'u3', at: new Date() })

    expect((await getAgentDevice('u1', 'mac-1'))?.addedAgents).toEqual([first])
  })

  test('leaves with the agent; a default agent removed keeps the others', async () => {
    await recordAgentAddition('u1', 'mac-1', first)
    await removeDeviceAgent('u1', 'mac-1', { provider: 'codex' })
    expect((await getAgentDevice('u1', 'mac-1'))?.addedAgents).toEqual([first])
    await removeDeviceAgent('u1', 'mac-1', { instanceId: work })
    expect((await getAgentDevice('u1', 'mac-1'))?.addedAgents).toEqual([])
  })

  test('a report from the host forgets an agent it no longer has', async () => {
    await recordAgentAddition('u1', 'mac-1', first)
    await recordDeviceAgents('u1', 'mac-1', { agents: {}, instances: [] })

    expect((await getAgentDevice('u1', 'mac-1'))?.addedAgents).toEqual([])
  })

  test('an addition noted while a report is being written survives it', async () => {
    const fresh = {
      instanceId: '55555555-5555-4555-8555-555555555555',
      userId: 'u3',
      at: new Date(),
    }
    const findOne = devices.findOne.bind(devices)

    await recordAgentAddition('u1', 'mac-1', first)
    // The add lands between the report's read and its write.
    devices.findOne = async (filter: Doc) => {
      const read = await findOne(filter)

      devices.findOne = findOne
      await recordAgentAddition('u1', 'mac-1', fresh)

      return read && { ...read }
    }
    await recordDeviceAgents('u1', 'mac-1', { agents: {}, instances: [] })

    expect((await getAgentDevice('u1', 'mac-1'))?.addedAgents).toEqual([fresh])
  })

  test('is noted only on the owner’s own device', async () => {
    await recordAgentAddition('u2', 'mac-1', first)

    expect((await getAgentDevice('u1', 'mac-1'))?.addedAgents).toBeUndefined()
  })
})

const reset = (id: string, agent: { instanceId: string } | { provider: 'codex' }) => ({
  id,
  agent,
  actorId: 'u2',
  teamId: 't1',
  at: new Date(0),
})

describe('pending resets', () => {
  beforeEach(async () => {
    devices.docs = []
    await upsertAgentDevice('u1', registration)
  })

  test('one per agent: a repeat adds nothing, another agent is noted', async () => {
    await recordAgentReset('u1', 'mac-1', reset('r1', { instanceId: 'a1' }))
    await recordAgentReset('u1', 'mac-1', reset('r2', { instanceId: 'a1' }))
    await recordAgentReset('u1', 'mac-1', reset('r3', { provider: 'codex' }))
    await recordAgentReset('u1', 'mac-1', reset('r4', { provider: 'codex' }))
    await recordAgentReset('u1', 'mac-1', reset('r5', { instanceId: 'a2' }))

    expect((await getAgentDevice('u1', 'mac-1'))?.pendingResets?.map(({ id }) => id)).toEqual([
      'r1',
      'r3',
      'r5',
    ])
  })

  test('is forgotten by id, and never hides the agent as a removal does', async () => {
    await recordAgentReset('u1', 'mac-1', reset('r1', { instanceId: 'a1' }))
    await recordAgentReset('u1', 'mac-1', reset('r2', { instanceId: 'a2' }))
    await forgetAgentReset('u1', 'mac-1', 'r1')

    const device = await getAgentDevice('u1', 'mac-1')

    expect(device?.pendingResets?.map(({ id }) => id)).toEqual(['r2'])
    expect(device?.removedAgents).toBeUndefined()
  })

  test('a reset run since retires the agent’s older ones, not newer ones or other agents’', async () => {
    await recordAgentReset('u1', 'mac-1', reset('r1', { instanceId: 'a1' }))
    await recordAgentReset('u1', 'mac-1', reset('r2', { provider: 'codex' }))
    await recordAgentReset('u1', 'mac-1', { ...reset('r3', { instanceId: 'a3' }), at: new Date(9) })
    await retireAgentResets('u1', 'mac-1', { instanceId: 'a1' }, new Date(5))
    await retireAgentResets('u1', 'mac-1', { instanceId: 'a3' }, new Date(5))

    expect((await getAgentDevice('u1', 'mac-1'))?.pendingResets?.map(({ id }) => id)).toEqual([
      'r2',
      'r3',
    ])
  })
})
