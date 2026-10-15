import assert from 'node:assert/strict'
import test from 'node:test'

import { createLimiter } from './limiter.ts'

test('no more than the limit run at once, and every task runs', async () => {
  const run = createLimiter(2)
  let running = 0
  let peak = 0
  const finished: number[] = []

  await Promise.all(
    Array.from(
      { length: 6 },
      (_, index) =>
        new Promise<void>((resolve) => {
          run(async () => {
            running += 1
            peak = Math.max(peak, running)
            await new Promise((wait) => setTimeout(wait, 5))
            running -= 1
            finished.push(index)
            resolve()
          })
        }),
    ),
  )
  assert.equal(peak, 2)
  assert.equal(finished.length, 6)
})

test('a failed task frees its slot', async () => {
  const run = createLimiter(1)

  let ran = false

  run(() => Promise.reject(new Error('gh failed')))
  await new Promise<void>((resolve) => {
    run(async () => {
      ran = true
      resolve()
    })
  })
  assert.equal(ran, true)
})
