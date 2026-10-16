import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { hashDeviceSecret } from '@/lib/agent/devices/join-tokens'
import { errorHandler } from '@/lib/errors'
import { requireAuthOrDeviceCredential } from '@/routes/agent/router'

import type { AgentDevice } from '@/lib/agent/devices/store'
import type { NuphosUser } from '@/lib/identity'
import type { AuthVariables } from '@/middleware/auth'

const CREDENTIAL = 'nbx_secret'
const USER = { id: 'owner', email: 'o@example.com', name: 'Owner' } as NuphosUser

function app(user: NuphosUser | null = USER, box = false) {
  const routes = new Hono<{ Variables: AuthVariables }>()

  routes.use(
    '*',
    requireAuthOrDeviceCredential({
      findDevice: async (hash) =>
        hash === hashDeviceSecret(CREDENTIAL)
          ? ({
              userId: 'owner',
              deviceId: 'd1',
              credentialIssuedAt: new Date('2026-10-14T00:00:00Z'),
              ...(box ? { box: { provider: 'instabox', teamId: 't1' } } : {}),
            } as AgentDevice)
          : null,
      getUser: async (id, issuedAt) =>
        user?.id === id && issuedAt >= signedOutEverywhereAt ? user : null,
    }),
  )
  routes.all('*', (c) => c.text(c.get('userId')))
  const root = new Hono()

  root.route('/agent', routes)
  root.onError(errorHandler)

  return root
}

let signedOutEverywhereAt = new Date(0)
const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } })

describe('device credentials on the agent routes', () => {
  test('open the device own runtime tunnel as its owner', async () => {
    const res = await app().request('/agent/devices/d1/runtime-tunnel', bearer(CREDENTIAL))

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('owner')
  })

  test('open nothing else', async () => {
    for (const path of [
      '/agent/devices/d2/runtime-tunnel',
      '/agent/devices/d1/audit',
      '/agent/conversations',
      '/agent/devices/d1/box/access',
      '/agent/devices/d1/box/desktop',
      '/agent/devices?teamId=another-team',
    ]) {
      expect((await app().request(path, bearer(CREDENTIAL))).status).toBe(401)
    }
  })

  test('stop working once revoked or once the owner is gone', async () => {
    expect(
      (await app().request('/agent/devices/d1/runtime-tunnel', bearer('nbx_old'))).status,
    ).toBe(401)
    expect(
      (await app(null).request('/agent/devices/d1/runtime-tunnel', bearer(CREDENTIAL))).status,
    ).toBe(401)
  })

  test('stop working once the owner signs out everywhere', async () => {
    signedOutEverywhereAt = new Date('2026-10-15T00:00:00Z')
    expect(
      (await app().request('/agent/devices/d1/runtime-tunnel', bearer(CREDENTIAL))).status,
    ).toBe(401)
    signedOutEverywhereAt = new Date(0)
  })

  test('a Box credential outlives its creator signing out everywhere or leaving', async () => {
    signedOutEverywhereAt = new Date('2026-10-15T00:00:00Z')
    for (const res of [
      await app(USER, true).request('/agent/devices/d1/runtime-tunnel', bearer(CREDENTIAL)),
      await app(null, true).request('/agent/devices/d1/runtime-tunnel', bearer(CREDENTIAL)),
    ]) {
      expect(res.status).toBe(200)
      expect(await res.text()).toBe('owner')
    }
    signedOutEverywhereAt = new Date(0)
    // Still only its own tunnel, and nothing once revoked.
    expect(
      (await app(USER, true).request('/agent/devices/d1/audit', bearer(CREDENTIAL))).status,
    ).toBe(401)
    expect(
      (await app(USER, true).request('/agent/devices/d1/runtime-tunnel', bearer('nbx_old'))).status,
    ).toBe(401)
  })
})
