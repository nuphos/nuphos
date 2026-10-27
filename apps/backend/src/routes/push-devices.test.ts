import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { errorHandler } from '@/lib/errors'
import { createLiveActivityRoutes, createPushDeviceRoutes } from '@/routes/push-devices'

import type { PushDeviceRegistration, PushDeviceStore } from '@/lib/push/devices'
import type { LiveActivityRow, LiveActivityToken } from '@/lib/push/live-activities'
import type { AuthVariables } from '@/middleware/auth'

const TOKEN = 'AB'.repeat(32)
let registered: { userId: string; device: PushDeviceRegistration }[]
let unregistered: { userId: string; token: string }[]
let activities: { sessionId: string; token: LiveActivityToken; row: LiveActivityRow }[]

const store: PushDeviceStore = {
  register: async (userId, device) => {
    registered.push({ userId, device })
  },
  unregister: async (userId, token) => {
    unregistered.push({ userId, token })
  },
  listForUser: async () => [],
  removeToken: async () => {},
}

const app = new Hono<{ Variables: AuthVariables }>()

app.use('*', async (c, next) => {
  c.set('userId', 'user-1')
  await next()
})
app.route('/push', createPushDeviceRoutes(store))
app.route(
  '/push',
  createLiveActivityRoutes(
    async (sessionId, token, row) => {
      activities.push({ sessionId, token, row })
    },
    async (userId, teamId, sessionId) => {
      if (userId !== 'user-1' || teamId !== 'team-1') return null
      if (sessionId === 'readable') return { title: 'Fix login' }

      return sessionId === 'untitled' ? {} : null
    },
  ),
)
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
  activities = []
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

describe('Android FCM device registration', () => {
  const token = 'AbC:Mixed_Case-token.123'

  test('preserves the opaque FCM token and project binding', async () => {
    const response = await put({
      token,
      deviceId: 'android-1',
      platform: 'android',
      environment: 'production',
      bundleId: 'ai.nuphos.android',
      projectId: 'nuphos-android',
    })

    expect(response.status).toBe(200)
    expect(registered[0]?.device.token).toBe(token)
    expect(registered[0]?.device.projectId).toBe('nuphos-android')
  })
  test('unregisters Android tokens without changing their case', async () => {
    const response = await app.request(
      `/push/devices/${encodeURIComponent(token)}?platform=android`,
      { method: 'DELETE' },
    )

    expect(response.status).toBe(200)
    expect(unregistered[0]?.token).toBe(token)
  })
  test('rejects incomplete or invalid Android registration', async () => {
    expect((await put({ token, deviceId: 'd', platform: 'android' })).status).toBe(400)
    expect(
      (
        await put({
          token: 'bad token',
          deviceId: 'd',
          platform: 'android',
          environment: 'production',
          bundleId: 'ai.nuphos.android',
          projectId: 'nuphos-android',
        })
      ).status,
    ).toBe(400)
  })
})

describe('Live Activity registration', () => {
  function putActivity(body: Record<string, unknown>) {
    return app.request('/push/live-activities', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: TOKEN, teamId: 'team-1', environment: 'production', ...body }),
    })
  }

  test("stores the token with the conversation's own title, not the client's", async () => {
    expect((await putActivity({ sessionId: 'readable', title: 'Spoofed' })).status).toBe(200)
    expect(activities).toEqual([
      {
        sessionId: 'readable',
        token: { token: TOKEN.toLowerCase(), userId: 'user-1', environment: 'production' },
        row: { teamId: 'team-1', title: 'Fix login' },
      },
    ])
  })

  test('a readable conversation without a title still gets a row', async () => {
    expect((await putActivity({ sessionId: 'untitled' })).status).toBe(200)
    expect(activities.map((a) => a.row)).toEqual([{ teamId: 'team-1', title: '' }])
  })

  test('refuses a conversation the user cannot read', async () => {
    expect((await putActivity({ sessionId: 'someone-elses' })).status).toBe(404)
    expect((await putActivity({ sessionId: 'readable', teamId: 'team-2' })).status).toBe(404)
    expect(activities).toEqual([])
  })
})
