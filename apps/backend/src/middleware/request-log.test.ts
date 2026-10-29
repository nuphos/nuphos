import { expect, test } from 'bun:test'
import { Hono } from 'hono'

import { requestLog } from './request-log'

import { AppError, errorHandler, notFoundHandler } from '@/lib/errors'

import type { MiddlewareHandler } from 'hono'

// Stands in for the auth middleware, which sets userId inside next().
const signIn: MiddlewareHandler = async (c, next) => {
  c.set('userId', 'user-1')
  await next()
}

function buildApp(lines: Record<string, unknown>[]) {
  const app = new Hono()

  app.use(
    '*',
    requestLog((_level, _event, properties) => {
      lines.push(properties ?? {})
    }),
  )
  app.post('/agent/chat', () => {
    throw new AppError(409, 'runtime_not_accepting_message', 'Reading session settings', {
      secret: 'must-not-be-logged',
    })
  })
  app.get('/ok', (c) => c.json({ ok: true }))
  app.post('/signed-in', signIn, (c) => c.json({ ok: true }))
  app.notFound(notFoundHandler)
  app.onError(errorHandler)

  return app
}

test('a 4xx access log line carries the AppError code and nothing from the body', async () => {
  const lines: Record<string, unknown>[] = []
  const res = await buildApp(lines).request('/agent/chat', { method: 'POST' })

  expect(res.status).toBe(409)
  expect(lines).toHaveLength(1)
  expect(lines[0]).toMatchObject({
    path: '/agent/chat',
    status: 409,
    error_code: 'runtime_not_accepting_message',
  })
  expect(JSON.stringify(lines[0])).not.toContain('must-not-be-logged')
  expect(JSON.stringify(lines[0])).not.toContain('Reading session settings')
})

test('unknown routes log route_not_found; successes log no error code', async () => {
  const lines: Record<string, unknown>[] = []
  const app = buildApp(lines)

  await app.request('/missing')
  await app.request('/ok')
  expect(lines[0]).toMatchObject({ status: 404, error_code: 'route_not_found' })
  expect(lines[1]?.status).toBe(200)
  expect(lines[1]?.error_code).toBeUndefined()
})

test('a request made by a signed-in user logs who made it', async () => {
  const lines: Record<string, unknown>[] = []
  const app = buildApp(lines)

  await app.request('/signed-in', { method: 'POST' })
  await app.request('/ok')
  expect(lines[0]).toMatchObject({ path: '/signed-in', status: 200, user_id: 'user-1' })
  expect(lines[1]?.user_id).toBeUndefined()
})
