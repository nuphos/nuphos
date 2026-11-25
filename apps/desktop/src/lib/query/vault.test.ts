import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

import type { VaultStatus } from '../../types/vault.ts'

mock.module('../../api.ts', { namedExports: { api: {} } })
const { vaultStatusQuery } = await import('./vault.ts')

const device = (id: string, state: 'pending' | 'enrolled') => ({
  id,
  name: id,
  state,
  computer: false,
  fingerprint: 'AAAA',
})
const interval = (data: VaultStatus | undefined) => {
  const { refetchInterval } = vaultStatusQuery('u1')

  assert.equal(typeof refetchInterval, 'function')

  return (refetchInterval as (q: unknown) => number | false)({ state: { data } })
}

test('the status is polled while this computer waits for approval from another device', () => {
  const others = [device('cli', 'enrolled')]

  assert.ok(interval({ thisDeviceId: 'me', devices: [...others, device('me', 'pending')] }))
  assert.equal(
    interval({ thisDeviceId: 'me', devices: [...others, device('me', 'enrolled')] }),
    false,
  )
  assert.equal(interval({ thisDeviceId: null, devices: others }), false)
  assert.equal(interval(undefined), false)
})
