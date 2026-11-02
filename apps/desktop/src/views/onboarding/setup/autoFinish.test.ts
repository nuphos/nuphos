import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'

import { AUTO_FINISH_MS, autoFinish } from './autoFinish.ts'

describe('autoFinish', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }))
  afterEach(() => mock.timers.reset())

  it('moves on into the app by itself after the beat', () => {
    const onFinish = mock.fn()

    autoFinish(onFinish)
    mock.timers.tick(AUTO_FINISH_MS - 1)
    assert.equal(onFinish.mock.callCount(), 0)
    mock.timers.tick(1)
    assert.equal(onFinish.mock.callCount(), 1)
  })

  it('finishes once when the user clicks before the timer', () => {
    const onFinish = mock.fn()
    const auto = autoFinish(onFinish)

    auto.finish()
    auto.finish()
    mock.timers.tick(AUTO_FINISH_MS)
    assert.equal(onFinish.mock.callCount(), 1)
  })

  it('never finishes after the screen goes away', () => {
    const onFinish = mock.fn()
    const auto = autoFinish(onFinish)

    auto.cancel()
    mock.timers.tick(AUTO_FINISH_MS)
    auto.finish()
    assert.equal(onFinish.mock.callCount(), 0)
  })
})
