import assert from 'node:assert/strict'
import { mkdtempSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  credentialRevoked,
  deviceCredentialFor,
  deviceCredentialStore,
} from './device-credential.ts'

const API = 'http://backend.test'
const DEVICE = { deviceId: 'd1', label: 'vm-1' }
const options = (dataDir: string, joinToken?: string) => ({
  dataDir,
  apiUrl: API,
  tunnelUrl: `${API}/agent/devices/d1/runtime-tunnel`,
  device: DEVICE,
  headers: {},
  ...(joinToken ? { joinToken } : {}),
})

test('a join token becomes a credential kept only for this backend and computer', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'device-credential-'))
  const requests: { url: string; body: unknown }[] = []

  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init.body)) })

    return Response.json({ userId: 'u1', deviceId: 'd1', credential: 'nbx_1' }, { status: 201 })
  })

  const joined = await deviceCredentialFor(options(dataDir, 'nbj_1'))

  assert.deepEqual(joined, { apiUrl: API, userId: 'u1', deviceId: 'd1', credential: 'nbx_1' })
  assert.deepEqual(requests, [
    {
      url: `${API}/auth/devices/join`,
      body: { token: 'nbj_1', deviceId: 'd1', label: 'vm-1', platform: process.platform },
    },
  ])
  assert.equal(statSync(path.join(dataDir, 'device-credential.json')).mode & 0o777, 0o600)
  const store = deviceCredentialStore(dataDir)

  assert.equal(store.read(API, 'd1')?.credential, 'nbx_1')
  assert.equal(store.read('http://other.test', 'd1'), null)
  assert.equal(store.read(API, 'd2'), null)
})

test('a saved credential wins over a token passed again', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'device-credential-'))
  const urls: string[] = []

  deviceCredentialStore(dataDir).write({
    apiUrl: API,
    userId: 'u1',
    deviceId: 'd1',
    credential: 'nbx_saved',
  })
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    urls.push(url)

    return new Response(null, { status: 426 })
  })

  assert.equal((await deviceCredentialFor(options(dataDir, 'nbj_again')))?.credential, 'nbx_saved')
  assert.deepEqual(urls, [`${API}/agent/devices/d1/runtime-tunnel`])
})

test('a revoked credential is replaced by a new token', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'device-credential-'))

  deviceCredentialStore(dataDir).write({
    apiUrl: API,
    userId: 'u1',
    deviceId: 'd1',
    credential: 'nbx_revoked',
  })
  t.mock.method(globalThis, 'fetch', async (url: string) =>
    url.endsWith('/auth/devices/join')
      ? Response.json({ userId: 'u1', deviceId: 'd1', credential: 'nbx_new' }, { status: 201 })
      : new Response(null, { status: 401 }),
  )

  assert.equal((await deviceCredentialFor(options(dataDir, 'nbj_new')))?.credential, 'nbx_new')
  assert.equal(deviceCredentialStore(dataDir).read(API, 'd1')?.credential, 'nbx_new')
})

test('no saved credential and no token means the signed-in session is used', async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'device-credential-'))

  assert.equal(await deviceCredentialFor(options(dataDir)), null)
})

test('only a refusal counts as revoked, not an unreachable backend', async (t) => {
  const statuses = [401, 404, 426]

  t.mock.method(globalThis, 'fetch', async () => {
    const status = statuses.shift()

    if (status === undefined) throw new TypeError('fetch failed')

    return new Response(null, { status })
  })
  const revoked = () => credentialRevoked(`${API}/tunnel`, 'nbx_1', {})

  assert.equal(await revoked(), true)
  assert.equal(await revoked(), true)
  assert.equal(await revoked(), false)
  assert.equal(await revoked(), false)
})
