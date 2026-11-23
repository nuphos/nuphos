// A feature a deployment did not set up is an expected state, so it must not
// reach Error Tracking; real server errors still must.
import { beforeEach, expect, spyOn, test } from 'bun:test'
import { Hono } from 'hono'

import { usePosthog } from '@/lib/test/doubles/posthog'

const captured: unknown[] = []

usePosthog({
  captureException: (error) => {
    captured.push(error)
  },
})

const { AppError, errorHandler } = await import('@/lib/errors')

async function answer(err: unknown): Promise<void> {
  const app = new Hono()

  app.onError(errorHandler)
  app.get('/', () => {
    throw err
  })
  const warn = spyOn(console, 'warn').mockImplementation(() => null)
  const error = spyOn(console, 'error').mockImplementation(() => null)

  try {
    await app.request('/')
  } finally {
    warn.mockRestore()
    error.mockRestore()
  }
}

beforeEach(() => {
  captured.length = 0
})

test('a *_not_configured error stays out of Error Tracking', async () => {
  await answer(new AppError(503, 'knowledge_not_configured', 'not configured'))

  expect(captured).toHaveLength(0)
})

test('another 503 still reaches Error Tracking', async () => {
  const err = new AppError(503, 'memory_unavailable', 'down')

  await answer(err)

  expect(captured).toEqual([err])
})

test('an unexpected 500 still reaches Error Tracking', async () => {
  const err = new Error('boom')

  await answer(err)

  expect(captured).toEqual([err])
})
