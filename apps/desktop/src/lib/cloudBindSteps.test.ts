import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  GCP_STEPS_CONSOLE,
  GCP_STEPS_CONSOLE_FIRST_RUN,
  gcpContentStep,
  gcpGrantsOnBillingAccount,
  gcpSpec,
  gcpSteps,
} from './cloudBindSteps.ts'

const PURPOSES = ['operational'] as const

test('only the first-run operational scope grants on the billing account', () => {
  assert.equal(gcpGrantsOnBillingAccount('operational', true), true)
  assert.equal(gcpGrantsOnBillingAccount('operational', false), false)
})

test('the step list and the grant target agree on which procedure is running', () => {
  for (const purpose of PURPOSES) {
    for (const firstRun of [true, false]) {
      const billing = gcpSpec(purpose, firstRun).grantOn === 'billing-account'
      const steps = gcpSteps(purpose, firstRun)
      const where = `${purpose}/firstRun=${String(firstRun)}`

      assert.equal(billing, gcpGrantsOnBillingAccount(purpose, firstRun), where)
      assert.equal(steps.includes('Grant it billing access'), billing, where)
      assert.equal(steps.includes('Grant it project access'), !billing, where)
    }
  }
})

test('every step index maps onto the title it is showing', () => {
  const fullList = (billing: boolean) => (billing ? GCP_STEPS_CONSOLE_FIRST_RUN : GCP_STEPS_CONSOLE)

  for (const purpose of PURPOSES) {
    for (const firstRun of [true, false]) {
      const shown = gcpSteps(purpose, firstRun)
      const full = fullList(gcpGrantsOnBillingAccount(purpose, firstRun))

      shown.forEach((title, index) => {
        assert.equal(
          full[gcpContentStep(purpose, index)],
          title,
          `${purpose}/firstRun=${String(firstRun)} step ${String(index)} shows "${title}" but renders "${String(full[gcpContentStep(purpose, index)])}"`,
        )
      })
    }
  }
})

test('every route ends on the step that submits, so Connect always has its form', () => {
  for (const purpose of PURPOSES) {
    for (const firstRun of [true, false]) {
      assert.equal(
        gcpSteps(purpose, firstRun).at(-1),
        'Enter details',
        `${purpose}/firstRun=${String(firstRun)} must end on Enter details`,
      )
    }
  }
})
