import { expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { errorHandler } from '@/lib/errors'
import { useByosAccount } from '@/lib/test/doubles/byos-account'

import { uptimeKumaInstancesRoutes } from './uptime-kuma-instances'

import type { TeamAuthVariables } from '@/middleware/auth'

const instanceId = new ObjectId().toHexString()
const access = {
  memberAllowList: ['owner'],
  ownerUserId: 'owner',
  updatedAt: new Date(),
  updatedBy: 'owner',
}

useByosAccount({
  findUptimeKumaInstance: async () =>
    ({
      id: new ObjectId(instanceId),
      label: 'kuma',
      baseUrl: 'https://kuma.example.com',
      access,
    }) as never,
})

function app(userId: string) {
  const root = new Hono<{ Variables: TeamAuthVariables }>()

  root.use('*', async (c, next) => {
    c.set('teamId', new ObjectId().toHexString())
    c.set('userId', userId)
    c.set('teamRole', 'ADMINISTRATOR')
    await next()
  })
  root.route('/', uptimeKumaInstancesRoutes)

  return root.onError(errorHandler)
}

test("an admin cannot read another member's private Uptime Kuma credentials", async () => {
  expect((await app('admin').request(`/${instanceId}/credentials`)).status).toBe(403)
})

test('its owner can', async () => {
  expect((await app('owner').request(`/${instanceId}/credentials`)).status).toBe(200)
})
