import { Hono } from 'hono'

import { feedbackRequestSchema } from '@/lib/api/feedback'
import { consumeFeedbackRateLimit, saveFeedbackReport } from '@/lib/feedback'
import { clientIp } from '@/lib/request-origin'
import { zv } from '@/lib/validate'

import type { FeedbackRateLimitResult, FeedbackReport } from '@/lib/feedback'

type Dependencies = {
  consume(clientIp: string): Promise<FeedbackRateLimitResult>
  save(report: FeedbackReport, ip: string): Promise<{ id: string }>
}

// Public, unauthenticated: any person or agent can report a Nuphos bug or
// request a feature. Contract lives in lib/api/feedback.ts (/openapi.json).
export function createFeedbackRoutes(dependencies: Dependencies) {
  const routes = new Hono()

  routes.post('/', zv('json', feedbackRequestSchema), async (c) => {
    const ip =
      clientIp(c.req.header('CF-Connecting-IP'), c.req.header('X-Forwarded-For')) ?? 'unknown'
    const result = await dependencies.consume(ip)

    if (result === 'limited') return c.json({ error: 'rate_limited' }, 429)
    if (result === 'unavailable') return c.json({ error: 'limiter_unavailable' }, 503)

    return c.json(await dependencies.save(c.req.valid('json'), ip))
  })

  return routes
}

export const feedbackRoutes = createFeedbackRoutes({
  consume: consumeFeedbackRateLimit,
  save: saveFeedbackReport,
})
