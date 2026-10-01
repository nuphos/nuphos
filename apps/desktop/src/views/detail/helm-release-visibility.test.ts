import assert from 'node:assert/strict'
import test from 'node:test'

import { helmValuesAreVisible } from './helm-release-visibility.ts'

test('revealing one Helm release never reveals a different release', () => {
  const revealedPayloadKey = 'Secret\0release-a-payload'

  assert.equal(helmValuesAreVisible(revealedPayloadKey, revealedPayloadKey), true)
  assert.equal(helmValuesAreVisible(revealedPayloadKey, 'Secret\0release-b-payload'), false)
})
