import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  parseDeviceIdentity,
  readMachineKey,
  stableDeviceId,
  withStableDeviceId,
} from './device-identity-core.ts'

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

test('one stable id per machine and client kind, never the raw machine key', () => {
  const desktop = stableDeviceId('MACHINE-UUID', 'desktop')

  assert.match(desktop, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u)
  assert.equal(stableDeviceId('MACHINE-UUID', 'desktop'), desktop)
  assert.notEqual(stableDeviceId('MACHINE-UUID', 'cli'), desktop)
  assert.notEqual(stableDeviceId('OTHER-MACHINE', 'desktop'), desktop)
  assert.ok(!desktop.includes('MACHINE'))
})

test('an install moves onto the stable id and remembers the ids it replaces', () => {
  const stable = stableDeviceId('MACHINE-UUID', 'desktop')
  const moved = withStableDeviceId(identity, stable)

  assert.deepEqual(moved, { ...identity, deviceId: stable, previousDeviceIds: ['abc-123'] })
  assert.equal(withStableDeviceId(moved, stable), moved)
  assert.equal(withStableDeviceId(identity, null), identity)
  assert.deepEqual(parseDeviceIdentity(JSON.stringify(moved)), moved)
  // A second reinstall that minted another random id adds to the list.
  assert.deepEqual(
    withStableDeviceId({ ...moved, deviceId: 'def-456' }, stable).previousDeviceIds,
    ['abc-123', 'def-456'],
  )
})

test('reads a machine key on this platform, or none', () => {
  const key = readMachineKey()

  assert.ok(key === null || key.length > 0)
})
