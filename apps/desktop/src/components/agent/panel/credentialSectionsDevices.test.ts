import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { buildDeviceCredentialSections } from './credentialSections.ts'

describe('device credential sections', () => {
  test('lists an offline device, marked, so it can still be unticked', () => {
    const [section] = buildDeviceCredentialSections([
      { deviceId: 'm1', label: 'MacBook M1', platform: 'darwin', available: true },
      { deviceId: 'm5', label: 'MacBook M5', platform: 'darwin', available: false },
      // An older backend omits `available` and lists only usable devices.
      { deviceId: 'pc', label: 'PC', platform: 'win32' },
    ])

    assert.deepEqual(
      section?.items.map((item) => [item.id, item.sublabel]),
      [
        ['m1', 'darwin'],
        ['m5', 'darwin · Offline'],
        ['pc', 'win32'],
      ],
    )
  })
})
