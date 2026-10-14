import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import type * as dbActual from '@/lib/db'

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
  async updateOne(filter: Doc, update: { $set: Doc; $setOnInsert?: Doc }) {
    const hit = this.docs.find((d) => matches(d, filter))

    if (hit) Object.assign(hit, update.$set)
    else this.docs.push({ ...filter, ...update.$set, ...update.$setOnInsert })
  }
}

const collections = new Map<string, FakeCollection>()
const collection = (name: string) => {
  const existing = collections.get(name) ?? new FakeCollection()

  collections.set(name, existing)

  return existing
}

useDb({ db: (() => ({ collection })) as unknown as typeof dbActual.db })

const { hashDeviceSecret, issueDeviceJoinToken, redeemDeviceJoinToken } =
  await import('@/lib/agent/devices/join-tokens')

const MACHINE = { deviceId: 'd1', label: 'vm-1', platform: 'linux' }

beforeEach(() => collections.clear())

describe('device join tokens', () => {
  test('a token registers the device once and stores only a hash of its credential', async () => {
    const { token } = await issueDeviceJoinToken('u1', { label: 'build box' })

    expect(token.startsWith('nbj_')).toBe(true)
    const joined = await redeemDeviceJoinToken(token, MACHINE)

    expect(joined?.userId).toBe('u1')
    expect(joined?.credential.startsWith('nbx_')).toBe(true)
    expect(collection('agent_devices').docs).toEqual([
      expect.objectContaining({
        userId: 'u1',
        deviceId: 'd1',
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

  test('joining the same machine again replaces its credential', async () => {
    const first = await redeemDeviceJoinToken((await issueDeviceJoinToken('u1', {})).token, MACHINE)
    const second = await redeemDeviceJoinToken(
      (await issueDeviceJoinToken('u1', {})).token,
      MACHINE,
    )

    expect(collection('agent_devices').docs).toHaveLength(1)
    expect(collection('agent_devices').docs[0]?.credentialHash).toBe(
      hashDeviceSecret(second?.credential ?? ''),
    )
    expect(first?.credential).not.toBe(second?.credential)
  })
})
