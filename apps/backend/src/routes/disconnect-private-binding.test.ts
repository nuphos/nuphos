import { beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { errorHandler } from '@/lib/errors'
import { useByosAccount } from '@/lib/test/doubles/byos-account'
import { useModels } from '@/lib/test/doubles/models'

import { awsAccountsRoutes } from './aws-accounts'

import type { TeamAuthVariables } from '@/middleware/auth'

const roleId = new ObjectId()
let memberAllowList: string[] = []
let pulled = 0

const role = () => ({
  id: roleId,
  roleArn: 'arn:aws:iam::123456789012:role/owned',
  access: { memberAllowList, ownerUserId: 'owner', updatedAt: new Date(), updatedBy: 'owner' },
})

useByosAccount({ listAwsBindingsForAccount: async () => [role()] as never })
useModels({
  teamByosBindings: () =>
    ({
      updateOne: () => {
        pulled += 1

        return Promise.resolve({ matchedCount: 1, modifiedCount: 1 })
      },
    }) as never,
})

beforeEach(() => {
  pulled = 0
})

function disconnect(userId: string) {
  const app = new Hono<{ Variables: TeamAuthVariables }>()

  app.use('*', async (c, next) => {
    c.set('teamId', new ObjectId().toHexString())
    c.set('userId', userId)
    c.set('teamRole', 'ADMINISTRATOR')
    await next()
  })
  app.route('/', awsAccountsRoutes)

  return app
    .onError(errorHandler)
    .request(`/123456789012?roleId=${roleId.toHexString()}`, { method: 'DELETE' })
}

test("an admin cannot disconnect another member's private AWS role", async () => {
  memberAllowList = ['owner']
  expect((await disconnect('admin')).status).toBe(403)
  expect(pulled).toBe(0)
})

test('its owner can disconnect it, and an admin can disconnect a shared one', async () => {
  memberAllowList = ['owner']
  expect((await disconnect('owner')).status).toBe(204)
  memberAllowList = ['owner', 'u2']
  expect((await disconnect('admin')).status).toBe(204)
})
