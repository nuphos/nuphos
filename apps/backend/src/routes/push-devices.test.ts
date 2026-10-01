import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { errorHandler } from '@/lib/errors'
import { createPushDeviceRoutes } from '@/routes/push-devices'

import type { PushDeviceRegistration, PushDeviceStore } from '@/lib/push/devices'
import type { AuthVariables } from '@/middleware/auth'

const TOKEN = 'AB'.repeat(32)
let registered: { userId: string; device: PushDeviceRegistration }[]
let unregistered: { userId: string; token: string }[]

const store: PushDeviceStore = {
  register: async (userId, device) => {
    registered.push({ userId, device })
  },
  unregister: async (userId, token) => {
    unregistered.push({ userId, token })
  },
  listForUser: async () => [],
  removeToken: async () => undefined,
}

const app = new Hono<{ Variables: AuthVariables }>()

app.use('*', async (c, next) => {
  c.set('userId', 'user-1')
  await next()
})
app.route('/push', createPushDeviceRoutes(store))
app.onError(errorHandler)

function put(body: unknown) {
  return app.request('/push/devices', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  registered = []
  unregistered = []
})

describe('push device routes', () => {
  test('registers the device for the signed-in user with a normalized token', async () => {
    const response = await put({
      token: TOKEN,
      deviceId: 'vendor-id',
      environment: 'sandbox',
      bundleId: 'ai.nuphos.ios',
      platform: 'ios',
    })

    expect(response.status).toBe(200)
    expect(registered).toEqual([
      {
        userId: 'user-1',
        device: {
          token: TOKEN.toLowerCase(),
          deviceId: 'vendor-id',
          environment: 'sandbox',
          bundleId: 'ai.nuphos.ios',
          platform: 'ios',
        },
      },
    ])
  })

  test('rejects a malformed token or environment', async () => {
    expect((await put({ token: 'nope', deviceId: 'd', environment: 'sandbox' })).status).toBe(400)
    expect((await put({ token: TOKEN, deviceId: 'd', environment: 'staging' })).status).toBe(400)
    expect(registered).toEqual([])
  })

  test('unregisters only for the signed-in user', async () => {
    const response = await app.request(`/push/devices/${TOKEN}`, { method: 'DELETE' })

    expect(response.status).toBe(200)
    expect(unregistered).toEqual([{ userId: 'user-1', token: TOKEN.toLowerCase() }])
  })
})
