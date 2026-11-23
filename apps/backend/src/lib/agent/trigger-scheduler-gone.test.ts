import { UnrecoverableError } from 'bullmq'
import { expect, test } from 'bun:test'

import { runtimeGone } from '@/lib/claude-code-preview/runtime-refusal'

import { failForGoodIfGone } from './trigger-scheduler'

// Task reports and resource turns are queued with attempts to spare, for a
// runtime that is briefly away. One that is gone answers the same every time.
test('a job whose runtime is gone is not retried', () => {
  const gone = runtimeGone()

  expect(() => failForGoodIfGone(gone)).toThrow(UnrecoverableError)
  expect(() => failForGoodIfGone(gone)).toThrow(gone.message)
})

test('a job that fails for another reason keeps its retries', () => {
  const offline = new Error('Failed to connect')

  expect(() => failForGoodIfGone(offline)).toThrow(offline)
})
