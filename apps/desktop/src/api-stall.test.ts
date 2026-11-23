import assert from 'node:assert/strict'
import { test } from 'node:test'

import { api } from './api.ts'
import { setFrontendErrorReporter } from './lib/frontendErrorReporter.ts'

import type { FrontendErrorReport } from './lib/frontendErrorReporter.ts'

// The error reporter throttles repeats by message, and issue titles show the first message,
// so a message that names the measured time defeats both. The time travels as a property.
test('a slow call reads the same however long it took, with the time as a property', async () => {
  const reports: FrontendErrorReport[] = []
  let now = 0

  setFrontendErrorReporter((report) => reports.push(report))
  Object.defineProperty(globalThis, 'window', {
    value: { api: { agentListTriggers: () => Promise.resolve([]) } },
    configurable: true,
  })
  const realNow = performance.now.bind(performance)

  performance.now = () => now
  try {
    for (const seconds of [31, 64]) {
      const call = api.agentListTriggers()

      now += seconds * 1000
      await call
    }
  } finally {
    performance.now = realNow
  }

  assert.equal(reports.length, 2)
  assert.equal(reports[0]?.message, reports[1]?.message)
  assert.deepEqual(
    reports.map((report) => report.elapsedMs),
    [31_000, 64_000],
  )
})
