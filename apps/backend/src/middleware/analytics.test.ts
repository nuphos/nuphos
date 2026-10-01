import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { usePosthog } from '@/lib/test/doubles/posthog'

import { analyticsMiddleware } from './analytics'

let captured: string[] = []
let identified: { distinctId: string; properties?: Record<string, unknown> }[] = []

usePosthog({
  capture: (event) => {
    captured.push(event)
  },
  identify: (distinctId, properties) => {
    identified.push({ distinctId, properties })
  },
})

beforeEach(() => {
  captured = []
  identified = []
})

// The identify dedupe set is process-global, so each test uses its own userId.
function buildApp(userId: string) {
  const app = new Hono<{ Variables: { userId: string; userEmail: string; userName: string } }>()

  app.use('*', async (c, next) => {
    c.set('userId', userId)
    c.set('userEmail', `${userId}@example.com`)
    c.set('userName', userId)
    await next()
  })
  app.use('*', analyticsMiddleware)
  app.get('/agent/plans/:planId', (c) => c.json({ ok: true }))

  return app
}

describe('analyticsMiddleware', () => {
  test('emits no per-request events — request telemetry lives in OTel, not PostHog', async () => {
    const res = await buildApp('user-a').request('/agent/plans/abc123')

    expect(res.status).toBe(200)
    expect(captured).toHaveLength(0)
  })

  test('identifies the requesting user once per process', async () => {
    const app = buildApp('user-b')

    await app.request('/agent/plans/abc123')
    await app.request('/agent/plans/def456')

    expect(identified).toHaveLength(1)
    expect(identified[0]).toEqual({
      distinctId: 'user-b',
      properties: { email: 'user-b@example.com', name: 'user-b' },
    })
  })
})
