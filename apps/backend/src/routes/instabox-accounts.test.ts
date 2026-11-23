// Replace key swaps the API key of the same binding, so the team's computers on it stay
// attached, and only after instabox takes the new key as it takes a new account's.
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { config } from '@/config'
import { errorHandler } from '@/lib/errors'
import { useByosSecrets } from '@/lib/test/doubles/byos-secrets'
import { useModels } from '@/lib/test/doubles/models'

import type { TeamAuthVariables } from '@/middleware/auth'

const TEAM_ID = new ObjectId()
const accountId = new ObjectId()
const savedFetch = globalThis.fetch
const savedInstabox = config.box.instabox
const updates: { filter: unknown; update: unknown }[] = []

useModels({
  teamByosBindings: (() => ({
    findOne: () =>
      Promise.resolve({
        instaboxAccounts: [
          {
            id: accountId,
            label: 'Team',
            encryptedApiKey: 'sealed',
            createdAt: new Date(),
            keyRejectedAt: new Date(),
          },
        ],
      }),
    updateOne: (filter: unknown, update: unknown) => {
      updates.push({ filter, update })

      return Promise.resolve({})
    },
  })) as never,
})
useByosSecrets({ encryptInstaboxSecret: (key: string) => `sealed:${key}` })

const { instaboxAccountsRoutes } = await import('@/routes/instabox-accounts')

function app() {
  const outer = new Hono<{ Variables: TeamAuthVariables }>()

  outer.onError(errorHandler)
  outer.use('*', async (c, next) => {
    c.set('teamId', TEAM_ID.toHexString())
    c.set('teamRole', 'ADMINISTRATOR')
    await next()
  })
  outer.route('/', instaboxAccountsRoutes)

  return outer
}

/** instabox answering `GET /v1/me` with `status`. */
function instaboxAnswers(status: number) {
  globalThis.fetch = (() =>
    Promise.resolve(
      Response.json({ allowedSpecs: [{ vcpus: 2, memMiB: 4096 }] }, { status }),
    )) as unknown as typeof fetch
}

const replace = (apiKey: string) =>
  app().request(`/${accountId.toHexString()}/key`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  })

beforeEach(() => {
  updates.length = 0
  config.box.instabox = { apiKey: 'ibk_deployment', apiUrl: 'https://instabox.test' }
})

afterEach(() => {
  globalThis.fetch = savedFetch
  config.box.instabox = savedInstabox
})

test('a key instabox takes replaces the binding’s key in place and clears the mark', async () => {
  instaboxAnswers(200)
  const response = await replace('ibk_new')

  expect(response.status).toBe(204)
  expect(updates).toEqual([
    {
      filter: { _id: TEAM_ID, 'instaboxAccounts.id': accountId },
      update: {
        $set: {
          'instaboxAccounts.$.encryptedApiKey': 'sealed:ibk_new',
          updatedAt: expect.any(Date),
        },
        $unset: { 'instaboxAccounts.$.keyRejectedAt': '' },
      },
    },
  ])
})

test('a key instabox refuses changes nothing', async () => {
  instaboxAnswers(401)
  const response = await replace('ibk_refused')

  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({
    error: { code: 'invalid_instabox_api_key' },
  })
  expect(updates).toEqual([])
})

test('the account list shows when its key was rejected', async () => {
  const response = await app().request('/')

  expect((await response.json()) as unknown).toMatchObject({
    accounts: [{ id: accountId.toHexString(), keyRejectedAt: expect.any(String) }],
  })
})
