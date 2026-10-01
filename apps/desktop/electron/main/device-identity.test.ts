import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseDeviceIdentity } from './device-identity-core.ts'

const identity = { deviceId: 'abc-123', label: 'My Mac', createdAt: '2026-01-01T00:00:00.000Z' }

test('parseDeviceIdentity accepts a device without an enable switch', () => {
  assert.deepEqual(parseDeviceIdentity(JSON.stringify(identity)), identity)
})

test('legacy local-exec preferences no longer affect the device identity', () => {
  for (const allowLocalExec of [true, false, null, 'false']) {
    assert.deepEqual(parseDeviceIdentity(JSON.stringify({ ...identity, allowLocalExec })), identity)
  }
})

test('parseDeviceIdentity rejects malformed or incomplete payloads', () => {
  assert.equal(parseDeviceIdentity('not json'), null)
  assert.equal(parseDeviceIdentity('{}'), null)
  assert.equal(
    parseDeviceIdentity(JSON.stringify({ deviceId: '', label: 'x', createdAt: 't' })),
    null,
  )
  assert.equal(parseDeviceIdentity(JSON.stringify({ deviceId: 'x', createdAt: 't' })), null)
  assert.equal(parseDeviceIdentity(JSON.stringify({ deviceId: 'x', label: 'y' })), null)
})
