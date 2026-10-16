import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'

import type * as dbActual from '@/lib/db'
import type * as identityActual from '@/lib/identity'

// Run with: cd apps/backend && bun test src/lib/agent/devices/join-tokens.test.ts

type Doc = Record<string, unknown>

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      const op = expected as { $gt?: Date; $exists?: boolean }

      if (op.$exists !== undefined) return (doc[key] !== undefined) === op.$exists
      if (op.$gt) return doc[key] instanceof Date && (doc[key] as Date) > op.$gt
    }

    return doc[key] === expected
  })
}

class FakeCollection {
  docs: Doc[] = []

  async insertOne(doc: Doc) {
    this.docs.push({ ...doc })
  }
  async findOneAndUpdate(filter: Doc, update: { $set: Doc }) {
    const hit = this.docs.find((d) => matches(d, filter))

    if (hit) Object.assign(hit, update.$set)

    return hit ?? null
  }
  async updateOne(
    filter: Doc,
    update: { $set: Doc; $setOnInsert?: Doc },
    options?: { upsert?: boolean },
  ) {
    const hit = this.docs.find((d) => matches(d, filter))

    if (hit) Object.assign(hit, update.$set)
    else if (options?.upsert) this.docs.push({ ...filter, ...update.$set, ...update.$setOnInsert })

    return { matchedCount: hit ? 1 : 0 }
  }
}

const collections = new Map<string, FakeCollection>()
const collection = (name: string) => {
  const existing = collections.get(name) ?? new FakeCollection()

  collections.set(name, existing)

  return existing
}

useDb({ db: (() => ({ collection })) as unknown as typeof dbActual.db })
// u1 signed out everywhere at this time; tokens issued before it are dead.
let signedOutEverywhereAt = new Date(0)

useIdentity({
  getNuphosUserForCredential: (async (userId: string, issuedAt: Date) =>
    userId === 'u1' && issuedAt >= signedOutEverywhereAt
      ? { id: userId }
      : null) as unknown as typeof identityActual.getNuphosUserForCredential,
})

const { hashDeviceSecret, issueDeviceJoinToken, redeemDeviceJoinToken } =
  await import('@/lib/agent/devices/join-tokens')

const MACHINE = { label: 'vm-1', platform: 'linux' }

beforeEach(() => {
  collections.clear()
  signedOutEverywhereAt = new Date(0)
})

describe('device join tokens', () => {
  test('a token registers the device once and stores only a hash of its credential', async () => {
    const { token } = await issueDeviceJoinToken('u1', { label: 'build box' })

    expect(token.startsWith('nbj_')).toBe(true)
    const joined = await redeemDeviceJoinToken(token, MACHINE)

    expect(joined?.userId).toBe('u1')
    expect(joined?.credential.startsWith('nbx_')).toBe(true)
    // A person's own computer joined with a token is not a Box.
    expect(joined?.box).toBeUndefined()
    expect(collection('agent_devices').docs).toEqual([
      expect.objectContaining({
        userId: 'u1',
        deviceId: joined?.deviceId,
        label: 'build box',
        platform: 'linux',
        allowLocalExec: true,
        credentialHash: hashDeviceSecret(joined?.credential ?? ''),
      }),
    ])
    expect(await redeemDeviceJoinToken(token, MACHINE)).toBeNull()
  })

  test('an expired or unknown token does nothing', async () => {
    const { token } = await issueDeviceJoinToken('u1', { expiresInSec: -1 })

    expect(await redeemDeviceJoinToken(token, MACHINE)).toBeNull()
    expect(await redeemDeviceJoinToken('nbj_unknown', MACHINE)).toBeNull()
    expect(await redeemDeviceJoinToken('not-a-token', MACHINE)).toBeNull()
    expect(collection('agent_devices').docs).toEqual([])
  })

  test('every join is a new device with a server-chosen id', async () => {
    const first = await redeemDeviceJoinToken((await issueDeviceJoinToken('u1', {})).token, MACHINE)
    const second = await redeemDeviceJoinToken(
      (await issueDeviceJoinToken('u1', {})).token,
      MACHINE,
    )

    expect(first?.deviceId).toMatch(/^[0-9a-f-]{36}$/)
    expect(second?.deviceId).not.toBe(first?.deviceId)
    expect(collection('agent_devices').docs).toHaveLength(2)
  })

  test('a token issued before signing out everywhere is refused', async () => {
    const { token } = await issueDeviceJoinToken('u1', {})

    signedOutEverywhereAt = new Date(Date.now() + 1000)
    expect(await redeemDeviceJoinToken(token, MACHINE)).toBeNull()
    expect(collection('agent_devices').docs).toEqual([])
  })

  test('a token made for a Box claims that Box row, once, and never a device in use', async () => {
    const box = { provider: 'instabox', sandboxId: 'm_1', teamId: 't1' }

    await collection('agent_devices').insertOne({
      userId: 'u1',
      deviceId: 'box-1',
      label: 'Box',
      platform: 'linux',
      allowLocalExec: true,
      box,
    })
    const { token } = await issueDeviceJoinToken('u1', { deviceId: 'box-1', expiresInSec: 3600 })
    const joined = await redeemDeviceJoinToken(token, MACHINE)

    expect(joined?.deviceId).toBe('box-1')
    expect(joined?.box).toBe(true)
    expect(collection('agent_devices').docs).toEqual([
      expect.objectContaining({
        deviceId: 'box-1',
        credentialHash: hashDeviceSecret(joined?.credential ?? ''),
      }),
    ])
    // A second token for the same row finds a credential already there and gives nothing.
    const { token: again } = await issueDeviceJoinToken('u1', { deviceId: 'box-1' })

    expect(await redeemDeviceJoinToken(again, MACHINE)).toBeNull()
    expect(collection('agent_devices').docs).toHaveLength(1)
  })

  test('a Box token still joins after the creator signs out everywhere or is gone', async () => {
    for (const [creator, deviceId] of [
      ['u1', 'box-1'],
      ['departed', 'box-2'],
    ] as const) {
      await collection('agent_devices').insertOne({
        userId: creator,
        deviceId,
        label: 'Box',
        platform: 'linux',
        allowLocalExec: true,
        box: { provider: 'instabox', sandboxId: `m_${deviceId}`, teamId: 't1' },
      })
      const { token } = await issueDeviceJoinToken(creator, { deviceId, expiresInSec: 3600 })

      signedOutEverywhereAt = new Date(Date.now() + 1000)
      expect((await redeemDeviceJoinToken(token, MACHINE))?.deviceId).toBe(deviceId)
    }
  })
})
