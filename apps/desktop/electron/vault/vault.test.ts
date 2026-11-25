import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, mock, test } from 'node:test'

import { fingerprint, generateDeviceKey, unwrap } from './crypto.ts'

type Device = { id: string; name: string; publicKey: string; state: 'pending' | 'enrolled' }
type Item = { ciphertext: string; keys: { deviceId: string; wrapped: string }[] }

// The backend's vault routes, in memory.
const backend = { devices: [] as Device[], items: new Map<string, Item>(), calls: [] as string[] }
// One team's shared vault: which of the members' devices are in it, and its items.
const team = { shared: new Set<string>(), items: new Map<string, Item>() }
const fail = (status: number) => Object.assign(new Error(String(status)), { status })

function teamRoute(method: string, [kind, id, action]: string[], body: Record<string, unknown>) {
  if (kind === 'devices' && method === 'GET')
    return {
      devices: backend.devices.map((d) => ({
        ...d,
        userName: 'Alex',
        shared: team.shared.has(d.id),
      })),
    }
  if (kind === 'devices' && action === 'add') {
    for (const { name, wrapped } of body.keys as { name: string; wrapped: string }[])
      team.items.get(name)?.keys.push({ deviceId: id, wrapped })
    team.shared.add(id)

    return {}
  }
  if (kind === 'items' && !id) return { items: [...team.items.keys()].map((name) => ({ name })) }
  if (method === 'GET' && team.items.has(id)) return { item: team.items.get(id) }
  if (method === 'PUT') return team.items.set(id, body as Item) && {}
  throw fail(404)
}

function route(method: string, url: string, body: Record<string, unknown>) {
  const [, , kind, id, action, ...rest] = url.split('/')

  if (kind === 'teams') return teamRoute(method, [action, ...rest], body)

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
    for (const { name, wrapped } of body.keys as { name: string; wrapped: string }[])
      backend.items.get(name)?.keys.push({ deviceId: device.id, wrapped })
    device.state = 'enrolled'

    return {}
  }
  if (kind === 'devices' && method === 'DELETE') {
    backend.devices = backend.devices.filter((d) => d.id !== id)

    return {}
  }
  if (kind === 'items' && !id) return { items: [...backend.items.keys()].map((name) => ({ name })) }
  const item = backend.items.get(id)

  if (method === 'GET' && item) return { item }
  if (method === 'PUT') return backend.items.set(id, body as Item) && {}
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
const teamVault = await import('./team.ts')

beforeEach(() => {
  backend.devices = []
  backend.items.clear()
  backend.calls = []
  team.shared.clear()
  team.items.clear()
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

test('the first device is trusted, and every enrolled device can open what it saves', async () => {
  const status = await vault.enroll()

  assert.equal(status.devices[0].state, 'enrolled')
  const other = otherDevice('enrolled')

  await vault.setItem('github-token', 'ghp_example')
  assert.equal(await vault.getItem('github-token'), 'ghp_example')
  const wrapped = backend.items
    .get('github-token')
    ?.keys.find((k) => k.deviceId === other.device.id)

  assert.ok(wrapped)
  assert.equal(unwrap(wrapped.wrapped, 'github-token', other.privateKey).length, 32)
})

test('approve wraps keys only for the key whose fingerprint was compared', async () => {
  await vault.enroll()
  await vault.setItem('github-token', 'ghp_example')
  const pending = otherDevice('pending')
  const shown = fingerprint(Buffer.from(pending.device.publicKey, 'base64'))

  // The backend swaps the key after the dialog showed the real one.
  pending.device.publicKey = generateDeviceKey().publicKey.toString('base64')
  await assert.rejects(vault.approve(pending.device.id, shown), /key changed/)
  assert.ok(!backend.calls.some((c) => c.endsWith('/approve')))

  const real = otherDevice('pending')

  await vault.approve(real.device.id, fingerprint(Buffer.from(real.device.publicKey, 'base64')))
  const wrapped = backend.items.get('github-token')?.keys.find((k) => k.deviceId === real.device.id)

  assert.ok(wrapped)
  assert.equal(unwrap(wrapped.wrapped, 'github-token', real.privateKey).length, 32)
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
  await assert.rejects(vault.setItem('../x', 'v'), /A name is/)
  await assert.rejects(vault.setItem('big', 'x'.repeat(64 * 1024 + 1)), /at most 64 KiB/)
  assert.ok(!backend.calls.some((c) => c.startsWith('PUT')))
})

test('a team vault starts with this device, and adds another only for the compared key', async () => {
  const { thisDeviceId } = await vault.enroll()
  const other = otherDevice('enrolled')
  const mine = (await teamVault.teamStatus('t1')).devices.find((d) => d.id === thisDeviceId)

  assert.ok(mine && !mine.shared)
  await teamVault.addTeamDevice('t1', mine.id, mine.fingerprint)
  await vault.setItem('claude-token', 'sk-example', 't1')
  // Wrapped for the team vault's devices only, and kept apart from the person's own.
  assert.deepEqual(
    team.items.get('claude-token')?.keys.map((k) => k.deviceId),
    [thisDeviceId],
  )
  assert.equal(backend.items.size, 0)
  assert.equal(await vault.getItem('claude-token', 't1'), 'sk-example')

  const shown = fingerprint(Buffer.from(other.device.publicKey, 'base64'))

  other.device.publicKey = generateDeviceKey().publicKey.toString('base64')
  await assert.rejects(teamVault.addTeamDevice('t1', other.device.id, shown), /key changed/)
  const real = otherDevice('enrolled')

  await teamVault.addTeamDevice(
    't1',
    real.device.id,
    fingerprint(Buffer.from(real.device.publicKey, 'base64')),
  )
  const wrapped = team.items.get('claude-token')?.keys.find((k) => k.deviceId === real.device.id)

  assert.ok(wrapped)
  assert.equal(unwrap(wrapped.wrapped, 'claude-token', real.privateKey).length, 32)
})
