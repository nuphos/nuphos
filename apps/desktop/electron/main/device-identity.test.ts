import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  parseDeviceIdentity,
  parseIoregPlatformUuid,
  parseRegMachineGuid,
  readMachineKey,
  stableDeviceId,
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

test('reads the machine key from ioreg and reg output', () => {
  const ioreg = `+-o J314sAP  <class IOPlatformExpertDevice, id 0x100000214, registered>
    {
      "IOPlatformSerialNumber" = "C02XXXXXXX"
      "IOPlatformUUID" = "1B8746E0-59E7-4E69-B08A-037AEE21CB41"
    }`
  const reg = `
HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography
    MachineGuid    REG_SZ    5a3c2b1e-0d4f-4a6b-9c8d-7e6f5a4b3c2d
`

  assert.equal(parseIoregPlatformUuid(ioreg), '1B8746E0-59E7-4E69-B08A-037AEE21CB41')
  assert.equal(parseRegMachineGuid(reg), '5a3c2b1e-0d4f-4a6b-9c8d-7e6f5a4b3c2d')
  assert.equal(parseIoregPlatformUuid('no uuid here'), null)
  assert.equal(parseRegMachineGuid('ERROR: The system was unable to find the value'), null)
  assert.ok(['string', 'object'].includes(typeof readMachineKey()))
})
