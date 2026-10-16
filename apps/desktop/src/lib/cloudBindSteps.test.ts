import assert from 'node:assert/strict'
import { test } from 'node:test'

import { GCP_STEPS_CONSOLE, gcpContentStep, gcpSteps } from './cloudBindSteps.ts'

test('every step index maps onto the title it is showing', () => {
  gcpSteps('operational').forEach((title, index) => {
    assert.equal(GCP_STEPS_CONSOLE[gcpContentStep('operational', index)], title)
  })
})

test('the route ends on the step that submits, so Connect always has its form', () => {
  assert.equal(gcpSteps('operational').at(-1), 'Enter details')
})
