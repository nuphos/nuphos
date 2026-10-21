import { beforeEach, describe, expect, setSystemTime, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'

import type * as dbActual from '@/lib/db'
import type * as identityActual from '@/lib/identity'

// Run with: cd apps/backend && bun test src/lib/identity/device-login.test.ts

type Doc = Record<string, unknown>

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && '$gt' in (expected as Doc)) {
      const value = doc[key]

      return value instanceof Date && value.getTime() > (expected as { $gt: Date }).$gt.getTime()
    }
    const value = doc[key]

    return value && typeof value === 'object' && 'equals' in value
      ? (value as { equals: (o: unknown) => boolean }).equals(expected)
      : value === expected
  })
}

class FakeCollection {
  docs: Doc[] = []

  async insertOne(doc: Doc) {
    if (this.docs.some((d) => d.userCodeHash && d.userCodeHash === doc.userCodeHash)) {
      throw Object.assign(new Error('dup'), { code: 11000 })
    }
    this.docs.push({ ...doc })

    return { insertedId: doc._id }
  }
  async findOne(filter: Doc) {
    return this.docs.find((d) => matches(d, filter)) ?? null
  }
  find(filter: Doc) {
    const hits = this.docs.filter((d) => matches(d, filter))
    const cursor = { sort: () => cursor, limit: () => cursor, toArray: async () => hits }

    return cursor
  }
  async findOneAndUpdate(filter: Doc, update: { $set: Doc }, opts?: { returnDocument?: string }) {
    const hit = this.docs.find((d) => matches(d, filter))

    if (!hit) return null
    const before = { ...hit }

    Object.assign(hit, update.$set)

    return opts?.returnDocument === 'before' ? before : hit
  }
  async updateOne(filter: Doc, update: { $set: Doc }) {
    const hit = this.docs.find((d) => matches(d, filter))

    if (hit) Object.assign(hit, update.$set)

    return { matchedCount: hit ? 1 : 0 }
  }
  async findOneAndDelete(filter: Doc) {
    const hit = this.docs.find((d) => matches(d, filter))

    if (!hit) return null
    this.docs = this.docs.filter((d) => d !== hit)

    return hit
  }
  async deleteOne(filter: Doc) {
    const hit = this.docs.find((d) => matches(d, filter))

    if (hit) this.docs = this.docs.filter((d) => d !== hit)

    return { deletedCount: hit ? 1 : 0 }
  }
  async createIndex() {
    return ''
  }
}

const collections = new Map<string, FakeCollection>()
const collection = (name: string) => {
  let existing = collections.get(name)

  if (!existing) {
    existing = new FakeCollection()
    collections.set(name, existing)
  }

  return existing
}

const USER = {
  id: '507f1f77bcf86cd799439011',
  email: 'yuanlin@example.com',
  name: 'Yuanlin',
  username: 'yuanlin',
  avatarURL: '',
  language: 'en-US',
  createdAt: '2026-01-01T00:00:00.000Z',
}
const TEAM = '69e989027ab63e8d6a0ffcb6'
const OTHER_TEAM = '69e989027ab63e8d6a0ffcb7'

useDb({ db: () => ({ collection }) })
useIdentity({
  getNuphosUserById: async (id: string) => (id === USER.id ? USER : null),
  getNuphosUserForCredential: async (id: string) => (id === USER.id ? USER : null),
  getTeamMembership: async (_userId: string, teamId: string) =>
    teamId === TEAM ? { role: 'EDITOR' } : null,
})

const {
  decideDeviceLogin,
  findPendingDeviceLogin,
  normalizeUserCode,
  pollDeviceLogin,
  startDeviceLogin,
} = await import('@/lib/identity/device-login')
const { authenticateCliToken, cliTokenDenied, listCliTokens, revokeCliToken } =
  await import('@/lib/identity/cli-tokens')

let now = new Date('2026-10-21T00:00:00Z')
const advance = (sec: number) => {
  now = new Date(now.getTime() + sec * 1000)
  setSystemTime(now)
}

beforeEach(() => {
  for (const c of collections.values()) c.docs = []
  now = new Date('2026-10-21T00:00:00Z')
  setSystemTime(now)
})

describe('device login', () => {
  test('approved as an agent: one poll gets a working agent token, then the request is gone', async () => {
    const started = await startDeviceLogin({ clientName: 'grok-box', requesterIp: '203.0.113.7' })

    expect(started.userCode).toMatch(/^[B-Z]{4}-[B-Z]{4}$/)
    expect(await pollDeviceLogin(started.deviceCode)).toEqual({ status: 'pending' })

    // Typed with other case and spacing on the approval page.
    const typed = started.userCode.toLowerCase().replace('-', ' ')

    expect(await findPendingDeviceLogin(typed)).toMatchObject({
      clientName: 'grok-box',
      requesterIp: '203.0.113.7',
    })
    await decideDeviceLogin(typed, USER, { decision: 'agent', name: 'Grok Bot', teamId: TEAM })

    advance(5)
    const result = await pollDeviceLogin(started.deviceCode)

    if (result.status !== 'approved') throw new Error(result.status)
    expect(result.token.startsWith('nup_')).toBe(true)
    expect(result.cliToken).toMatchObject({ kind: 'agent', name: 'Grok Bot', teamId: TEAM })

    const auth = await authenticateCliToken(result.token)

    expect(auth?.user.id).toBe(USER.id)
    expect(auth?.cliToken.kind).toBe('agent')

    advance(5)
    expect(await pollDeviceLogin(started.deviceCode)).toEqual({ status: 'expired' })
    // The code cannot be approved twice either.
    await expect(decideDeviceLogin(typed, USER, { decision: 'personal' })).rejects.toThrow()
  })

  test('approved as me: a personal token named after the machine', async () => {
    const started = await startDeviceLogin({ clientName: 'laptop' })

    await decideDeviceLogin(started.userCode, USER, { decision: 'personal' })
    const result = await pollDeviceLogin(started.deviceCode)

    if (result.status !== 'approved') throw new Error(result.status)
    expect(result.cliToken).toMatchObject({ kind: 'personal', name: 'laptop' })
    expect(result.cliToken.teamId).toBeUndefined()
  })

  test('polling faster than the interval is slow_down', async () => {
    const started = await startDeviceLogin({})

    expect(await pollDeviceLogin(started.deviceCode)).toEqual({ status: 'pending' })
    advance(1)
    expect(await pollDeviceLogin(started.deviceCode)).toEqual({ status: 'slow_down' })
  })

  test('denied, expired, unknown and malformed codes', async () => {
    const started = await startDeviceLogin({})

    await decideDeviceLogin(started.userCode, USER, { decision: 'deny' })
    expect(await pollDeviceLogin(started.deviceCode)).toEqual({ status: 'denied' })

    const late = await startDeviceLogin({})

    advance(601)
    expect(await pollDeviceLogin(late.deviceCode)).toEqual({ status: 'expired' })
    expect(await findPendingDeviceLogin(late.userCode)).toBeNull()
    expect(await pollDeviceLogin('nope')).toEqual({ status: 'expired' })
    expect(normalizeUserCode('ABC')).toBeNull()
  })

  test('an agent token only for a team the approver belongs to', async () => {
    const started = await startDeviceLogin({})

    await expect(
      decideDeviceLogin(started.userCode, USER, {
        decision: 'agent',
        name: 'x',
        teamId: OTHER_TEAM,
      }),
    ).rejects.toThrow('not a member')
  })

  test('tokens are listed and revoked by their owner only', async () => {
    const started = await startDeviceLogin({ clientName: 'box' })

    await decideDeviceLogin(started.userCode, USER, { decision: 'personal' })
    const result = await pollDeviceLogin(started.deviceCode)

    if (result.status !== 'approved') throw new Error(result.status)
    const [listed] = await listCliTokens(USER.id)

    expect(listed).toMatchObject({ id: result.cliToken.id, kind: 'personal', name: 'box' })
    expect(await revokeCliToken('507f1f77bcf86cd799439099', listed!.id)).toBe(false)
    expect(await revokeCliToken(USER.id, listed!.id)).toBe(true)
    expect(await authenticateCliToken(result.token)).toBeNull()
  })
})

describe('what each token kind may call', () => {
  const agent = { kind: 'agent' as const }
  const personal = { kind: 'personal' as const }

  test('neither kind mints agent tokens or approves device codes', () => {
    for (const kind of [agent, personal]) {
      expect(cliTokenDenied(kind, 'POST', '/auth/cli-tokens')).not.toBeNull()
      expect(cliTokenDenied(kind, 'GET', '/auth/device/approve')).not.toBeNull()
      expect(cliTokenDenied(kind, 'POST', '/auth/device/approve')).not.toBeNull()
      // A join token redeems into a device credential that survives revoking this one.
      expect(cliTokenDenied(kind, 'POST', '/agent/devices/join-tokens')).not.toBeNull()
    }
  })

  test('a personal token lists and revokes its own', () => {
    expect(cliTokenDenied(personal, 'GET', '/auth/cli-tokens')).toBeNull()
    expect(cliTokenDenied(personal, 'DELETE', '/auth/cli-tokens/abc')).toBeNull()
  })

  test('an agent token stays off the account, tokens, membership and billing', () => {
    for (const [method, path] of [
      ['GET', '/auth/cli-tokens'],
      ['DELETE', '/auth/cli-tokens/abc'],
      ['POST', '/auth/account-deletion'],
      ['PATCH', '/auth/me'],
      ['PUT', '/auth/me/avatar'],
      ['POST', '/push/devices'],
      ['POST', '/invitations/x/accept'],
      ['POST', '/personal-credentials/github'],
      ['POST', '/teams'],
      ['DELETE', `/teams/${TEAM}`],
      ['PATCH', `/teams/${TEAM}/members/u1`],
      ['POST', `/teams/${TEAM}/invitations`],
      ['POST', `/teams/${TEAM}/leave`],
      ['GET', `/teams/${TEAM}/billing/usage`],
      ['GET', '/agent/devices'],
      ['PUT', '/agent/devices'],
      ['POST', '/agent/devices/join-tokens'],
      ['DELETE', '/agent/devices/d1'],
      ['DELETE', '/agent/devices/d1/credential'],
      ['POST', '/agent/devices/boxes'],
    ]) {
      expect([method, path, cliTokenDenied(agent, method!, path!)]).not.toEqual([
        method,
        path,
        null,
      ])
    }
  })

  test('an agent token does the work its user can', () => {
    for (const [method, path] of [
      ['GET', '/auth/me'],
      ['POST', '/agent/chat'],
      ['GET', '/agent/conversations'],
      ['GET', `/teams/${TEAM}/members`],
      ['GET', `/teams/${TEAM}/agent-runtimes`],
      ['POST', `/teams/${TEAM}/agent-triggers`],
    ]) {
      expect(cliTokenDenied(agent, method!, path!)).toBeNull()
    }
  })
})
