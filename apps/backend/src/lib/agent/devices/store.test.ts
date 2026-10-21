// Run with: cd apps/backend && bun test src/lib/agent/devices/store.test.ts

import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import type { LocalRuntimeStatus } from './local-runtime/protocol'
import type * as dbActual from '@/lib/db'

type Doc = Record<string, unknown>

type Push = { $each: Doc[]; $slice: number }

// The only operator filter the store uses: no added agent with that instance id yet.
function matches(doc: Doc, [key, value]: [string, unknown]): boolean {
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
    update: { $set?: Doc; $setOnInsert?: Doc; $push?: Record<string, Push>; $pull?: Doc },
    options?: { upsert?: boolean },
  ) {
    const hit = await this.findOne(filter)

    if (hit) Object.assign(hit, update.$set)
    else if (options?.upsert) this.docs.push({ ...filter, ...update.$set, ...update.$setOnInsert })
    for (const [field, push] of Object.entries(update.$push ?? {}))
      if (hit) hit[field] = [...((hit[field] ?? []) as Doc[]), ...push.$each].slice(push.$slice)
    for (const [field, pulled] of Object.entries(update.$pull ?? {})) {
      const id = (pulled as Doc).instanceId
      const drop = (value: unknown) =>
        typeof id === 'object' && id ? (id as { $in: unknown[] }).$in.includes(value) : value === id

      if (hit && field === 'addedAgents')
        hit[field] = ((hit[field] ?? []) as Doc[]).filter((entry) => !drop(entry.instanceId))
    }

    return { matchedCount: hit ? 1 : 0 }
  }
}

const devices = new FakeCollection()

useDb({ db: (() => ({ collection: () => devices })) as unknown as typeof dbActual.db })

const { getAgentDevice, renameAgentDevice, upsertAgentDevice } = await import('./store')
const { recordAgentAddition, recordDeviceAgents, removeDeviceAgent, renameDeviceAgent } =
  await import('./agent-registry-store')

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
