import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, mock, test } from 'node:test'

import { fingerprint, generateDeviceKey, unwrap } from './crypto.ts'

type Device = {
  id: string
  name: string
  publicKey: string
  state: 'pending' | 'enrolled'
}
type Item = {
  ciphertext: string
  keys: { deviceId: string; wrapped: string }[]
  updatedAt: string
}

// The backend's vault routes, in memory.
const backend = { devices: [] as Device[], items: new Map<string, Item>(), calls: [] as string[] }
const fail = (status: number) => Object.assign(new Error(String(status)), { status })
let clock = 0
const tick = () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++clock)).toISOString()

function route(method: string, url: string, body: Record<string, unknown>) {
  const [, , kind, id, action] = url.split('/')

  if (kind === 'devices' && method === 'GET') return { devices: backend.devices }
  if (kind === 'devices' && method === 'POST' && !id) {
    const device: Device = {
      id: randomUUID(),
      name: body.name as string,
      publicKey: body.publicKey as string,
      state: backend.devices.length ? 'pending' : 'enrolled',
    }

    backend.devices.push(device)

    return { device }
  }
  const device = backend.devices.find((d) => d.id === id)

  if (kind === 'devices' && action === 'approve' && device) {
    device.state = 'enrolled'

    return {}
  }
  if (kind === 'devices' && method === 'DELETE') {
    backend.devices = backend.devices.filter((d) => d.id !== id)

    return {}
  }
  if (kind === 'items' && !id)
    return {
      items: [...backend.items].map(([name, item]) => ({
        name,
        updatedAt: item.updatedAt,
        deviceIds: item.keys.map((k) => k.deviceId),
      })),
    }
  const item = backend.items.get(id)

  if (method === 'GET' && item) return { item }
  if (method === 'PUT') {
    if ((item?.updatedAt ?? null) !== body.updatedAt) throw fail(409)
    const { ciphertext, keys } = body as Item

    return backend.items.set(id, { ciphertext, keys, updatedAt: tick() }) && {}
  }
  if (method === 'DELETE') return backend.items.delete(id) && {}
  throw fail(404)
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'))
const keychain = { failSet: false, entries: new Map<string, string>(), secure: false }

mock.module('../account-request.ts', {
  namedExports: { signedIn: async () => ({ api: 'http://backend', userId: 'u1', token: 't' }) },
})
mock.module('../atlas/client.ts', {
  namedExports: {
    call: async (method: string, url: string, body?: Record<string, unknown>) => {
      backend.calls.push(`${method} ${url}`)

      return route(method, url, body ?? {})
    },
  },
})
mock.module('../auth/token-store.ts', {
  namedExports: {
    secureStorageEnabled: () => keychain.secure,
    keychainFor: () => ({
      get: async (k: string) => keychain.entries.get(k) ?? null,
      set: async (k: string, v: string) => {
        if (keychain.failSet) throw new Error('no keychain')
        keychain.entries.set(k, v)
      },
      delete: async (k: string) => keychain.entries.delete(k),
    }),
  },
})
mock.module('../cli-config-path.ts', {
  namedExports: { DESKTOP_CONFIG_PATH: path.join(dir, 'desktop.yaml') },
})

const vault = await import('./vault.ts')

beforeEach(() => {
  backend.devices = []
  backend.items.clear()
  backend.calls = []
  Object.assign(keychain, { failSet: false, secure: false, entries: new Map() })
  fs.rmSync(path.join(dir, 'vault-u1.yaml'), { force: true })
})

/** A device that is not this app: a CLI, say, with its own key. */
function otherDevice(state: Device['state']) {
  const key = generateDeviceKey()
  const device: Device = {
    id: randomUUID(),
    name: 'other',
    publicKey: key.publicKey.toString('base64'),
    state,
  }

  backend.devices.push(device)

  return { device, privateKey: key.privateKey }
}

const holders = (name: string) => backend.items.get(name)?.keys.map((k) => k.deviceId)
const at = (name: string) => backend.items.get(name)?.updatedAt as string

test('the first device is trusted, and only the devices picked can open what it saves', async () => {
  const status = await vault.enroll()
  const mine = status.thisDeviceId as string

  assert.equal(status.devices[0].state, 'enrolled')
  const other = otherDevice('enrolled')

  otherDevice('enrolled')
  await vault.setItem('github-token', 'ghp_example', [mine, other.device.id], null)
  assert.equal(await vault.getItem('github-token'), 'ghp_example')
  assert.deepEqual(holders('github-token'), [mine, other.device.id])
  const wrapped = backend.items
    .get('github-token')
    ?.keys.find((k) => k.deviceId === other.device.id)

  assert.ok(wrapped)
  assert.equal(unwrap(wrapped.wrapped, 'github-token', other.privateKey).length, 32)
})

test('sharing wraps the same key for a device added and drops the one left out', async () => {
  const mine = (await vault.enroll()).thisDeviceId as string
  const box = otherDevice('enrolled')

  await vault.setItem('deploy', 'secret', [mine], null)
  const before = backend.items.get('deploy')?.ciphertext
  const first = at('deploy')

  await vault.shareItem('deploy', [mine, box.device.id], first)
  const shared = backend.items.get('deploy')

  assert.equal(shared?.ciphertext, before)
  const wrapped = shared?.keys.find((k) => k.deviceId === box.device.id)

  assert.ok(wrapped)
  assert.equal(unwrap(wrapped.wrapped, 'deploy', box.privateKey).length, 32)

  await vault.shareItem('deploy', [mine], at('deploy'))
  assert.deepEqual(holders('deploy'), [mine])
  // A choice made on an older read is refused, so it cannot undo the change above.
  await assert.rejects(vault.shareItem('deploy', [mine, box.device.id], first), /409/)
  await assert.rejects(vault.setItem('deploy', 'new', [mine], null), /409/)
  assert.deepEqual(holders('deploy'), [mine])
  // A device not given the item cannot open it from here either.
  backend.items.set('other', {
    ciphertext: 'c',
    keys: [{ deviceId: box.device.id, wrapped: 'w' }],
    updatedAt: tick(),
  })
  await assert.rejects(vault.getItem('other'), /not shared with this device/)
})

test('approve sends only the key whose fingerprint was compared, and wraps nothing', async () => {
  const mine = (await vault.enroll()).thisDeviceId as string

  await vault.setItem('github-token', 'ghp_example', [mine], null)
  const pending = otherDevice('pending')
  const shown = fingerprint(Buffer.from(pending.device.publicKey, 'base64'))

  // The backend swaps the key after the dialog showed the real one.
  pending.device.publicKey = generateDeviceKey().publicKey.toString('base64')
  await assert.rejects(vault.approve(pending.device.id, shown), /key changed/)
  assert.ok(!backend.calls.some((c) => c.endsWith('/approve')))

  const real = otherDevice('pending')

  await vault.approve(real.device.id, fingerprint(Buffer.from(real.device.publicKey, 'base64')))
  // It gets items as they are shared with it.
  assert.deepEqual(holders('github-token'), [mine])
})

test('a device whose key could not be kept is taken back out of the vault', async () => {
  Object.assign(keychain, { secure: true, failSet: true })
  await assert.rejects(vault.enroll(), /no keychain/)
  assert.deepEqual(backend.devices, [])
})

test('two enrolls at once add one device', async () => {
  await Promise.all([vault.enroll(), vault.enroll()])
  assert.equal(backend.devices.length, 1)
})

test('a pending device cannot read, and removing this device forgets its key', async () => {
  otherDevice('enrolled')
  const status = await vault.enroll()

  assert.ok(status.thisDeviceId)
  await assert.rejects(vault.getItem('github-token'), /Approve this device/)
  await vault.removeDevice(status.thisDeviceId)
  assert.equal(fs.existsSync(path.join(dir, 'vault-u1.yaml')), false)
  assert.equal((await vault.status()).thisDeviceId, null)
})

test('names and sizes are checked before anything is sent', async () => {
  await vault.enroll()
  backend.calls = []
  await assert.rejects(vault.setItem('../x', 'v', [], null), /A name is/)
  await assert.rejects(vault.setItem('big', 'x'.repeat(64 * 1024 + 1), [], null), /at most 64 KiB/)
  assert.ok(!backend.calls.some((c) => c.startsWith('PUT')))
})
