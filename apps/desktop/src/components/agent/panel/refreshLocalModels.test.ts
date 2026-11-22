import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

import { namesNoModel, REPORT_SETTLE_MS, refreshLocalModels } from './refreshLocalModels.ts'

const settle = () => new Promise((resolve) => setImmediate(resolve))

// #4261: this read the picker again only when the local list changed, so a picker with no
// models stayed empty even once its computer could list them.
test('an asked computer has its picker read again once its list could have reached the backend', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    let reads = 0

    refreshLocalModels(
      () => Promise.resolve(),
      () => reads++,
    )
    await settle()
    assert.equal(reads, 0)
    mock.timers.tick(REPORT_SETTLE_MS)
    assert.equal(reads, 1)
  } finally {
    mock.timers.reset()
  }
})

test('a failed ask reads nothing again: there was no computer to ask', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    let reads = 0

    refreshLocalModels(
      () => Promise.reject(new Error('no local runtime')),
      () => reads++,
    )
    await settle()
    mock.timers.tick(REPORT_SETTLE_MS)
    assert.equal(reads, 0)
  } finally {
    mock.timers.reset()
  }
})

test('a started chat whose model the list lacks is the one that asks again', () => {
  const model = (currentValue: string) => ({
    id: 'model',
    name: 'Model',
    kind: 'model' as const,
    currentValue,
    options: [{ value: 'gpt-5.6-terra', name: 'GPT-5.6-Terra' }],
  })

  assert.equal(namesNoModel({ status: 'ready', options: [model('')] }), true)
  assert.equal(namesNoModel({ status: 'ready', options: [model('gpt-5.6-terra')] }), false)
  assert.equal(namesNoModel({ status: 'offline', options: [] }), false)
  assert.equal(namesNoModel(undefined), false)
})
