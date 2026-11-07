import assert from 'node:assert/strict'
import { test } from 'node:test'

import { secretSaveFailure } from './secretCardModel.ts'

const backendError = (code: string, message: string) =>
  new Error(`__ATLAS_API_ERROR__${JSON.stringify({ code, message })}`)

test('a runtime too old for an inline secret is reported as outdated, never as a retry', () => {
  assert.equal(
    secretSaveFailure(
      backendError(
        'runtime_outdated',
        'The computer running this agent needs Nuphos Desktop 0.95.0',
      ),
    ),
    'outdated',
  )
})

test('a failure that could clear on its own stays retryable', () => {
  assert.equal(secretSaveFailure(backendError('runtime_unavailable', 'No running agent')), 'error')
  assert.equal(secretSaveFailure(new TypeError('fetch failed')), 'error')
  assert.equal(secretSaveFailure(undefined), 'error')
})
