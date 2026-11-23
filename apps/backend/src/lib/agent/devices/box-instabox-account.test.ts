import { ObjectId } from 'mongodb'
import { afterEach, beforeEach, expect, test } from 'bun:test'

import { config } from '@/config'
import { useBoxInstaboxLimit } from '@/lib/test/doubles/box-instabox-limit'
import { useByosSecrets } from '@/lib/test/doubles/byos-secrets'
import { useModels } from '@/lib/test/doubles/models'

import { boxConnection } from './box-instabox-account'
import { startBox } from './box-instabox-start'

// A Box on a team's own instabox account uses that account's key, and is not
// held to the deployment's vCPU limit, which only Nuphos's own account bills.
const teamId = '65f000000000000000000001'
const accountId = new ObjectId()
const savedInstabox = config.box.instabox
const savedFetch = globalThis.fetch
const limited: string[] = []
const marks: unknown[] = []
let keyRejectedAt: Date | undefined

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
            ...(keyRejectedAt ? { keyRejectedAt } : {}),
          },
        ],
      }),
    updateOne: (_filter: unknown, update: unknown) => {
      marks.push(update)

      return Promise.resolve({})
    },
  })) as never,
})
useByosSecrets({ decryptInstaboxSecret: () => 'ibk_team' })
useBoxInstaboxLimit({
  startWithinLimit: (team: string, _starting: unknown, start: () => Promise<unknown>) => {
    limited.push(team)

    return start()
  },
})

beforeEach(() => {
  limited.length = 0
  marks.length = 0
  keyRejectedAt = undefined
  config.box.instabox = { apiKey: 'ibk_deployment', apiUrl: 'https://instabox.test' }
})

afterEach(() => {
  config.box.instabox = savedInstabox
  globalThis.fetch = savedFetch
})

test("a Box on a team account connects with the team's key", async () => {
  expect(await boxConnection({ teamId, accountId: accountId.toHexString() }, 30_000)).toMatchObject(
    { apiKey: 'ibk_team', apiUrl: 'https://instabox.test' },
  )
  expect(await boxConnection({ teamId }, 30_000)).toMatchObject({ apiKey: 'ibk_deployment' })
})

test('the team account works without a deployment key', async () => {
  config.box.instabox = null
  expect(await boxConnection({ teamId, accountId: accountId.toHexString() }, 30_000)).toMatchObject(
    { apiKey: 'ibk_team' },
  )
  await expect(boxConnection({ teamId }, 30_000)).rejects.toMatchObject({ status: 503 })
})

test('a Box whose account is no longer bound is unreachable, not on the deployment key', async () => {
  await expect(
    boxConnection({ teamId, accountId: new ObjectId().toHexString() }, 30_000),
  ).rejects.toMatchObject({ status: 409, code: 'box_unavailable' })
})

test("only the deployment's account counts against the vCPU limit", async () => {
  expect(await startBox({ teamId, accountId: 'a1' }, { vcpus: 4 }, async () => 'team')).toBe('team')
  expect(await startBox({ teamId }, { vcpus: 4 }, async () => 'deployment')).toBe('deployment')
  expect(limited).toEqual([teamId])
})

/** instabox answering every call with `status` and, for an error, `code`. */
function instaboxAnswers(status: number, code?: string) {
  globalThis.fetch = (() =>
    Promise.resolve(
      Response.json(code ? { error: { code } } : {}, { status }),
    )) as unknown as typeof fetch
}

test('a key instabox refuses is marked on its binding once, and cleared by the next call it takes', async () => {
  const conn = await boxConnection({ teamId, accountId: accountId.toHexString() }, 30_000)

  instaboxAnswers(401, 'expired_key')
  await conn.fetch?.('https://instabox.test/v1/sandboxes')
  await conn.fetch?.('https://instabox.test/v1/sandboxes')
  instaboxAnswers(200)
  await conn.fetch?.('https://instabox.test/v1/sandboxes')
  await conn.fetch?.('https://instabox.test/v1/sandboxes')

  expect(marks).toEqual([
    { $set: { 'instaboxAccounts.$.keyRejectedAt': expect.any(Date) } },
    { $unset: { 'instaboxAccounts.$.keyRejectedAt': '' } },
  ])
})

test("a plan's 403 or an outage says nothing about the key", async () => {
  keyRejectedAt = new Date()
  const conn = await boxConnection({ teamId, accountId: accountId.toHexString() }, 30_000)

  instaboxAnswers(503)
  await conn.fetch?.('https://instabox.test/v1/sandboxes')
  keyRejectedAt = undefined
  const fresh = await boxConnection({ teamId, accountId: accountId.toHexString() }, 30_000)

  instaboxAnswers(403, 'spec_not_allowed')
  await fresh.fetch?.('https://instabox.test/v1/sandboxes')
  expect(marks).toEqual([])
})

test("the deployment's own key is never watched", async () => {
  expect(await boxConnection({ teamId }, 30_000)).not.toHaveProperty('fetch')
})
