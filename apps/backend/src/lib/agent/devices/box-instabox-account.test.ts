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
const limited: string[] = []

useModels({
  teamByosBindings: (() => ({
    findOne: () =>
      Promise.resolve({
        instaboxAccounts: [
          { id: accountId, label: 'Team', encryptedApiKey: 'sealed', createdAt: new Date() },
        ],
      }),
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
  config.box.instabox = { apiKey: 'ibk_deployment', apiUrl: 'https://instabox.test' }
})

afterEach(() => {
  config.box.instabox = savedInstabox
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
