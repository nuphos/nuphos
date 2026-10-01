import { Hono } from 'hono'

import { db } from '@/lib/db'
import { isShuttingDown } from '@/lib/lifecycle'
import { pingRedis, redisEnabled } from '@/lib/redis'

export const health = new Hono()

health.get('/', (c) => {
  return c.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  })
})

health.get('/db', async (c) => {
  const result = await db().command({ ping: 1 })

  return c.json({ status: 'ok', ping: result })
})

health.get('/redis', async (c) => {
  if (!redisEnabled()) {
    return c.json({ status: 'disabled' })
  }
  const ok = await pingRedis()

  return c.json({ status: ok ? 'ok' : 'unavailable' }, ok ? 200 : 503)
})

// Readiness probe: 200 only when this pod is ready to take traffic. K8s uses
// it to decide when to add us to the Service endpoints, and we flip it to 503
// on shutdown so the LB removes us BEFORE we stop accepting connections.
//
// Redis is intentionally NOT a readiness gate: it's a shared dependency, so a
// Sentinel failover or brief outage would flip every replica to 503 at once,
// deregistering the whole Service. The cross-replica paths degrade gracefully
// when Redis is down, and same-replica traffic keeps working. Use
// /health/redis to monitor Redis health independently.
health.get('/ready', async (c) => {
  if (isShuttingDown()) {
    return c.json({ status: 'shutting_down' }, 503)
  }
  try {
    await db().command({ ping: 1 })
  } catch {
    return c.json({ status: 'db_unavailable' }, 503)
  }

  return c.json({ status: 'ok' })
})
