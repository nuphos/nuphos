import { expect, test } from 'bun:test'
import { Hono } from 'hono'

import { errorHandler } from '@/lib/errors'
import { useAuthMiddleware } from '@/lib/test/doubles/auth-middleware'

useAuthMiddleware({
  requireAuth: async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', '64b5f1c2e4b0a1d2c3e4f5a6')
    await next()
  },
})

await import('./routes-chat-post')
const { agent } = await import('./router')

const app = new Hono().route('/agent', agent).onError(errorHandler)

test('rejects a non-string session id before it reaches any query', async () => {
  const response = await app.request('/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: { $ne: null }, messages: [] }),
  })

  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({ error: { code: 'invalid_request' } })
})

test('rejects a non-string stream id', async () => {
  const response = await app.request('/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'session-1', streamId: { $ne: null }, messages: [] }),
  })

  expect(response.status).toBe(400)
})
