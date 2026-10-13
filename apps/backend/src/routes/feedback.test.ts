import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { errorHandler } from '@/lib/errors'
import { createFeedbackRoutes } from '@/routes/feedback'

import type { FeedbackRateLimitResult, FeedbackReport } from '@/lib/feedback'

const REPORT = {
  type: 'bug',
  title: 'kubectl context missing after connect',
  description: 'get_kubeconfig returned no context for the EKS cluster I just connected.',
}

function setup(limit: FeedbackRateLimitResult = 'allowed') {
  const saved: { report: FeedbackReport; ip: string }[] = []
  const clients: string[] = []
  const app = new Hono()

  app.onError(errorHandler)
  app.route(
    '/feedback',
    createFeedbackRoutes({
      consume: (clientIp) => {
        clients.push(clientIp)

        return Promise.resolve(limit)
      },
      save: (report, ip) => {
        saved.push({ report, ip })

        return Promise.resolve({ id: 'report-1' })
      },
    }),
  )

  const post = (body: unknown, headers: Record<string, string> = {}) =>
    app.request('/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })

  return { post, saved, clients }
}

describe('feedback route', () => {
  test('records a valid report for triage', async () => {
    const { post, saved, clients } = setup()
    const response = await post(REPORT, { 'X-Forwarded-For': '1.1.1.1, 203.0.113.7' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: 'report-1' })
    expect(saved).toEqual([{ report: REPORT as FeedbackReport, ip: '203.0.113.7' }])
    expect(clients).toEqual(['203.0.113.7'])
  })

  test('prefers the Cloudflare client address', async () => {
    const { post, saved } = setup()

    await post(REPORT, { 'CF-Connecting-IP': '198.51.100.4', 'X-Forwarded-For': '192.0.2.1' })

    expect(saved.map(({ ip }) => ip)).toEqual(['198.51.100.4'])
  })

  test('rejects invalid reports without consuming quota', async () => {
    const { post, saved, clients } = setup()

    expect((await post({ ...REPORT, type: 'question' })).status).toBe(400)
    expect((await post({ ...REPORT, description: 'short' })).status).toBe(400)
    expect(saved).toEqual([])
    expect(clients).toEqual([])
  })

  test('does not record when the quota is exhausted or unavailable', async () => {
    const limited = setup('limited')
    const unavailable = setup('unavailable')

    expect((await limited.post(REPORT)).status).toBe(429)
    expect((await unavailable.post(REPORT)).status).toBe(503)
    expect([...limited.saved, ...unavailable.saved]).toEqual([])
  })
})
