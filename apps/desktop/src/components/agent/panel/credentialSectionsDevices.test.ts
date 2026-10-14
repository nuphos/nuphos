import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { buildDeviceCredentialSections } from './credentialSections.ts'

const devices = [
  { deviceId: 'm1', label: 'MacBook M1', platform: 'darwin', available: true },
  { deviceId: 'm5', label: 'MacBook M5', platform: 'darwin', available: false },
  // An older backend omits `available` and lists only usable devices.
  { deviceId: 'pc', label: 'PC', platform: 'win32' },
]

describe('device credentials', () => {
  test('lists every device, marking an unavailable one so it can be kept or unticked', () => {
    const [section] = buildDeviceCredentialSections(devices)

    assert.deepEqual(
      section?.items.map((item) => [item.id, item.sublabel]),
      [
        ['m1', 'darwin'],
        ['m5', 'darwin · Unavailable'],
        ['pc', 'win32'],
      ],
    )
  })
})
