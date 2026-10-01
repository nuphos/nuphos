import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { K8sUnauthorizedError, translateK8sError } from './errors.ts'

describe('translateK8sError', () => {
  it('replaces raw Kubernetes 401 details with an actionable message', () => {
    const translated = translateK8sError(
      new Error('HTTP-Code: 401 Message: Unauthorized Headers: {"audit-id":"should-not-be-shown"}'),
    )

    assert.ok(translated instanceof K8sUnauthorizedError)
    assert.match(translated.message, /Reconnect this cluster/)
    assert.doesNotMatch(translated.message, /audit-id/)
  })

  it('leaves unrelated failures unchanged', () => {
    const original = new Error('connection refused')

    assert.equal(translateK8sError(original), original)
  })
})
