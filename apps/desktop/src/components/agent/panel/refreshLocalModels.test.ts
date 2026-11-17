import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

import { namesNoModel, REPORT_SETTLE_MS, refreshLocalModels } from './refreshLocalModels.ts'

const settle = () => new Promise((resolve) => setImmediate(resolve))

test('a changed list on this computer reads the picker again once it reached the backend', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    let reads = 0

    refreshLocalModels(
      () => Promise.resolve(true),
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

test('an unchanged list or a failed ask reads nothing again', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    let reads = 0

    refreshLocalModels(
      () => Promise.resolve(false),
      () => reads++,
    )
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
