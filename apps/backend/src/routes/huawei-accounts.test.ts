// Huawei's trust-agency assumption authorizes by (identity provider, audience,
// agency) alone, so a second team registering the exact same triple could
// reuse another team's credentials. These tests cover both the friendly
// preflight rejection and the atomic write-time guard (the unique index) that
// actually closes the race.
import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { MongoServerError, ObjectId } from 'mongodb'

import { errorHandler } from '@/lib/errors'
import { useAuthMiddleware } from '@/lib/test/doubles/auth-middleware'
import { useByosHuawei } from '@/lib/test/doubles/byos-huawei'
import { useModels } from '@/lib/test/doubles/models'

import type { TeamAuthVariables } from '@/middleware/auth'

type UpdateCall = {
  filter: Record<string, unknown>
  update: Record<string, unknown>
}

const TEAM_ID = new ObjectId()
const DOMAIN_ID = '0a1b2c3d4e5f60718293a4b5c6d7e8f9'
const IDP_ID = 'nuphos'
const AGENCY_NAME = 'nuphos-readonly'

let updateCalls: UpdateCall[] = []
/** Set to simulate another team's document already holding the same triple. */
let claimedByOtherTeam = false
/** Thrown by the guarded $push (second updateOne) to simulate a lost race. */
let pushError: Error | null = null

useModels({
  teamByosBindings: () => ({
    findOne: async (filter: Record<string, unknown>) => {
      if ('_id' in filter && (filter._id as { $ne?: unknown }).$ne) {
        return claimedByOtherTeam ? { _id: new ObjectId(), huaweiAccounts: [] } : null
      }

      return null
    },
    updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      updateCalls.push({ filter, update })
      // First call is the upsert-team-doc $setOnInsert; only the second (the
      // guarded $push) is where the unique index would reject a race.
      if (updateCalls.length === 2 && pushError) throw pushError

      return { matchedCount: 1, modifiedCount: 1, upsertedId: null }
    },
  }),
})

useAuthMiddleware({
  requireTeamRole: () => async (_c: unknown, next: () => Promise<void>) => {
    await next()
  },
})

useByosHuawei({
  verifyHuaweiIdentity: async () => {},
})

const { huaweiAccountsRoutes } = await import('@/routes/huawei-accounts')

function app() {
  const outer = new Hono<{ Variables: TeamAuthVariables }>()

  outer.onError(errorHandler)
  outer.use('*', async (c, next) => {
    c.set('teamId', TEAM_ID.toHexString())
    c.set('userId', new ObjectId().toHexString())
    c.set('teamRole', 'ADMINISTRATOR')
    await next()
  })
  outer.route('/', huaweiAccountsRoutes)

  return outer
}

function bind(body: Record<string, unknown>) {
  return app().request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  updateCalls = []
  claimedByOtherTeam = false
  pushError = null
})

const VALID_BODY = {
  label: 'Acme Huawei Cloud',
  domainId: DOMAIN_ID,
  idpId: IDP_ID,
  agencyName: AGENCY_NAME,
}

describe('POST /huawei-accounts', () => {
  test('binds when the triple is unclaimed', async () => {
    const response = await bind(VALID_BODY)

    expect(response.status).toBe(201)
    expect(updateCalls).toHaveLength(2)
  })

  test('refuses up front when another team already claimed the same triple', async () => {
    claimedByOtherTeam = true

    const response = await bind(VALID_BODY)

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: 'account_already_bound' } })
    // The friendly preflight catches it before any write is attempted.
    expect(updateCalls).toHaveLength(0)
  })

  test('maps a lost race at the unique index to the same 409, not a 500', async () => {
    // The preflight passes (nobody else has it *yet*), but a concurrent team
    // wins the write first — the unique index rejects ours.
    pushError = Object.assign(new MongoServerError({ message: 'duplicate key' }), { code: 11000 })

    const response = await bind(VALID_BODY)

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: 'account_already_bound' } })
    expect(updateCalls).toHaveLength(2)
  })

  test('does not swallow an unrelated write failure', async () => {
    pushError = Object.assign(new MongoServerError({ message: 'not primary' }), { code: 10107 })

    const response = await bind(VALID_BODY)

    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ error: { code: 'internal_error' } })
  })
})
