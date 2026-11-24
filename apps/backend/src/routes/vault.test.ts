import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { hashDeviceSecret } from '@/lib/agent/devices/join-tokens'
import { AppError, errorHandler } from '@/lib/errors'
import { liveDevice } from '@/routes/agent/router'
import { offerKeyFromComputer, readComputerItem } from '@/routes/vault'

import type { AgentDevice } from '@/lib/agent/devices/store'
import type { NuphosUser } from '@/lib/identity'

// Run with: cd apps/backend && bun test src/routes/vault.test.ts

const CREDENTIAL = 'nbx_secret'
const OWNER = { id: 'owner', email: 'o@example.com', name: 'Owner' } as NuphosUser
const VAULT = 'vault-owner'

/** One computer, with CREDENTIAL as its device credential. */
const live =
  ({ box = false, signedOut = false } = {}) =>
  (header: string | undefined) =>
    liveDevice(header, {
      findDevice: async (hash) =>
        hash === hashDeviceSecret(CREDENTIAL)
          ? ({
              userId: 'owner',
              deviceId: 'computer-1',
              label: 'Studio Mac',
              credentialIssuedAt: new Date('2026-11-01T00:00:00Z'),
              ...(box ? { box: { provider: 'instabox', teamId: 't1' } } : {}),
            } as AgentDevice)
          : null,
      getUser: async (id) => (id === OWNER.id && !signedOut ? OWNER : null),
    })

/** `GET /vault/computer/items/:name` with one computer, linked to VAULT only. */
function app(options = {}) {
  const root = new Hono()

  root.get('/vault/computer/items/:name', (c) =>
    readComputerItem(c, {
      liveDevice: live(options),
      getItem: async (user, computer, name) => {
        if (user !== VAULT || computer.deviceId !== 'computer-1')
          throw new AppError(404, 'not_found', 'Item not found')

        return { deviceId: 'vault-device-1', item: { name } } as never
      },
    }),
  )
  root.onError(errorHandler)

  return root
}

const read = (token?: string, user = VAULT, options = {}) =>
  app(options).request(`/vault/computer/items/token?user=${user}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })

describe('a computer reading the vault with its device credential', () => {
  test('reads the item of the vault it was approved into', async () => {
    const res = await read(CREDENTIAL)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ deviceId: 'vault-device-1', item: { name: 'token' } })
  })

  test('a session token, no token or a revoked credential gets 401', async () => {
    for (const token of ['session-token', undefined, 'nbx_revoked'])
      expect((await read(token)).status).toBe(401)
  })

  test('a person computer stops once they sign out everywhere; a Box does not', async () => {
    expect((await read(CREDENTIAL, VAULT, { signedOut: true })).status).toBe(401)
    expect((await read(CREDENTIAL, VAULT, { box: true, signedOut: true })).status).toBe(200)
  })

  test('a vault it is not linked to gets 404', async () => {
    expect((await read(CREDENTIAL, 'someone-else')).status).toBe(404)
  })
})

describe('a computer offering its key when it joins', () => {
  const KEY = Buffer.alloc(32, 7).toString('base64')
  const offered: unknown[] = []
  const root = new Hono()

  root.post('/vault/computer/devices', (c) =>
    offerKeyFromComputer(c, {
      liveDevice: live(),
      offer: async (computer, publicKey) => {
        offered.push([computer.deviceId, publicKey])

        return { id: 'vault-device-2', state: 'pending' } as never
      },
    }),
  )
  root.onError(errorHandler)
  const offer = (token: string | undefined, body: unknown) =>
    root.request('/vault/computer/devices', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    })

  test('its own device credential registers its public key for its owner', async () => {
    const res = await offer(CREDENTIAL, { publicKey: KEY })

    expect(res.status).toBe(201)
    expect(offered).toEqual([['computer-1', KEY]])
  })

  test('a session token or no token gets 401, and anything but a key gets 400', async () => {
    for (const token of ['session-token', undefined])
      expect((await offer(token, { publicKey: KEY })).status).toBe(401)
    expect((await offer(CREDENTIAL, { publicKey: 'short' })).status).toBe(400)
    expect(offered).toHaveLength(1)
  })
})
