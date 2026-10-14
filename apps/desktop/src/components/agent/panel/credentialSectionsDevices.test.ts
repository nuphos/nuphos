import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { buildDeviceCredentialSections, usableDeviceIds } from './credentialSections.ts'

describe('device credential sections', () => {
  test('shows usable devices and a selected offline one, marked, so it can be unticked', () => {
    const [section] = buildDeviceCredentialSections(
      [
        { deviceId: 'm1', label: 'MacBook M1', platform: 'darwin', available: true },
        { deviceId: 'm5', label: 'MacBook M5', platform: 'darwin', available: false },
        // An unselected offline or long-gone registration stays hidden.
        { deviceId: 'old', label: 'MacBook M1', platform: 'darwin', available: false },
        // An older backend omits `available` and lists only usable devices.
        { deviceId: 'pc', label: 'PC', platform: 'win32' },
      ],
      ['m5'],
    )

    assert.deepEqual(
      section?.items.map((item) => [item.id, item.sublabel]),
      [
        ['m1', 'darwin'],
        ['m5', 'darwin · Unavailable'],
        ['pc', 'win32'],
      ],
    )
  })

  test('a new conversation defaults to the usable devices only', () => {
    assert.deepEqual(
      usableDeviceIds([
        { deviceId: 'm1', label: 'M1', platform: 'darwin', available: true },
        { deviceId: 'old', label: 'M1', platform: 'darwin', available: false },
        { deviceId: 'pc', label: 'PC', platform: 'win32' },
      ]),
      ['m1', 'pc'],
    )
  })
})
