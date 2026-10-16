// Run with: cd apps/backend && bun test src/lib/agent/devices/store.test.ts

import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import type { LocalRuntimeStatus } from './local-runtime/protocol'
import type * as dbActual from '@/lib/db'

type Doc = Record<string, unknown>

// What the store asks of its collection, over plain objects.
class FakeCollection {
  docs: Doc[] = []

  findOne(filter: Doc) {
    return Promise.resolve(
      this.docs.find((doc) => Object.entries(filter).every(([k, v]) => doc[k] === v)) ?? null,
    )
  }
  async updateOne(
    filter: Doc,
    update: { $set: Doc; $setOnInsert?: Doc },
    options?: { upsert?: boolean },
  ) {
    const hit = await this.findOne(filter)

    if (hit) Object.assign(hit, update.$set)
    else if (options?.upsert) this.docs.push({ ...filter, ...update.$set, ...update.$setOnInsert })

    return { matchedCount: hit ? 1 : 0 }
  }
}

const devices = new FakeCollection()

useDb({ db: (() => ({ collection: () => devices })) as unknown as typeof dbActual.db })

const {
  getAgentDevice,
  recordDeviceAgents,
  renameAgentDevice,
  renameDeviceAgent,
  upsertAgentDevice,
} = await import('./store')

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
