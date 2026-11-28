import { describe, expect, test } from 'bun:test'

import { personalCredentialDetails } from './credential-hints'

describe('personalCredentialDetails', () => {
  test.each(['github', 'linear', 'gmail'] as const)(
    'the %s hint names the connectionId to pass',
    (provider) => {
      const { hint } = personalCredentialDetails({ id: 'conn-1', provider, login: 'me' })

      expect(hint).toContain('connectionId is conn-1')
    },
  )
})
