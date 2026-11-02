import { expect, test } from 'bun:test'

import { shareTrustExpiry } from './local-share-trust'

test('a trust for 8 hours ends 8 hours on, and one for always never does', () => {
  const now = new Date('2026-10-30T04:00:00Z')

  expect(shareTrustExpiry('8h', now)?.toISOString()).toBe('2026-10-30T12:00:00.000Z')
  expect(shareTrustExpiry('always', now)).toBeUndefined()
})
