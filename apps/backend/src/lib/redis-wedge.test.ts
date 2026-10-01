import { describe, expect, test } from 'bun:test'

import { REDIS_OP_TIMEOUT_MESSAGE, createRedisWedgeDetector } from './redis-wedge'

const timeout = () => new Error(REDIS_OP_TIMEOUT_MESSAGE)

describe('redis wedge detector', () => {
  test('fires once after the threshold of consecutive timeouts', () => {
    let wedges = 0
    const detector = createRedisWedgeDetector(() => {
      wedges += 1
    }, 3)

    detector.failure(timeout())
    detector.failure(timeout())
    expect(wedges).toBe(0)
    detector.failure(timeout())
    expect(wedges).toBe(1)
    detector.failure(timeout())
    detector.failure(timeout())
    expect(wedges).toBe(1)
    detector.failure(timeout())
    expect(wedges).toBe(2)
  })

  test('a success or a non-timeout error resets the streak', () => {
    let wedges = 0
    const detector = createRedisWedgeDetector(() => {
      wedges += 1
    }, 3)

    detector.failure(timeout())
    detector.failure(timeout())
    detector.success()
    detector.failure(timeout())
    detector.failure(timeout())
    detector.failure(new Error('ECONNRESET'))
    detector.failure(timeout())
    detector.failure(timeout())
    expect(wedges).toBe(0)
  })
})
