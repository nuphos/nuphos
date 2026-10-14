import { describe, expect, test } from 'bun:test'

import { selectAgentCredentials } from './credential-prompt-selection'

import type { AgentCredentialOptions } from './types'

describe('selectAgentCredentials devices', () => {
  test('offers the model only the selected devices that are usable now', () => {
    const options = {
      devices: [
        { deviceId: 'm1', label: 'M1', platform: 'darwin', available: true },
        { deviceId: 'm5', label: 'M5', platform: 'darwin', available: false },
        { deviceId: 'pc', label: 'PC', platform: 'win32', available: true },
      ],
    } as AgentCredentialOptions

    expect(
      selectAgentCredentials({ deviceIds: ['m1', 'm5'] } as never, options).devices.map(
        (device) => device.deviceId,
      ),
    ).toEqual(['m1'])
  })
})
