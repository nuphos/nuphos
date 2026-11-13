import { expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { errorHandler } from '@/lib/errors'
import { useByosAccount } from '@/lib/test/doubles/byos-account'
import { useByosSecrets } from '@/lib/test/doubles/byos-secrets'

import { grafanaInstancesRoutes } from './grafana-instances'

import type { TeamAuthVariables } from '@/middleware/auth'

const instanceId = new ObjectId().toHexString()
const access = {
  memberAllowList: ['owner'],
  ownerUserId: 'owner',
  updatedAt: new Date(),
  updatedBy: 'owner',
}

useByosSecrets({ grafanaBindingToken: () => 'sa-token' })
useByosAccount({
  findGrafanaInstance: async () =>
    ({
      id: new ObjectId(instanceId),
      name: 'g',
      grafanaUrl: 'https://g.example.com',
      access,
    }) as never,
})

function app(userId: string, role: 'ADMINISTRATOR' | 'EDITOR') {
  const root = new Hono<{ Variables: TeamAuthVariables }>()

  root.use('*', async (c, next) => {
    c.set('teamId', new ObjectId().toHexString())
    c.set('userId', userId)
    c.set('teamRole', role)
    await next()
  })
  root.route('/', grafanaInstancesRoutes)

  return root.onError(errorHandler)
}

test("another member cannot read through a private Grafana instance's proxy", async () => {
  const response = await app('teammate', 'EDITOR').request(`/${instanceId}/proxy/api/search`)

  expect(response.status).toBe(403)
  expect(await response.json()).toMatchObject({
    error: { code: 'grafana_instance_access_denied' },
  })
})

test('an admin can still see who a private Grafana instance is shared with', async () => {
  const response = await app('admin', 'ADMINISTRATOR').request(`/${instanceId}/access`)

  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ memberAllowList: ['owner'] })
})
