import { Hono } from 'hono'

import { AppError } from '@/lib/errors'
import { handleRecallEvent } from '@/lib/meetings/meetings'
import { recallConfig, verifyRecallSignature } from '@/lib/meetings/recall'
import { logError } from '@/lib/observability'

import type { RecallEvent } from '@/lib/meetings/meetings'

export const meetingsRoutes = new Hono()

// Recall retries a slow answer, so the speech is posted after the 200.
meetingsRoutes.post('/recall/webhook', async (c) => {
  const { webhookSecret } = recallConfig()
  const body = await c.req.text()
  const id = c.req.header('webhook-id')
  const signed = verifyRecallSignature(
    webhookSecret,
    {
      id,
      timestamp: c.req.header('webhook-timestamp'),
      signature: c.req.header('webhook-signature'),
    },
    body,
  )

  if (!signed || !id)
    throw new AppError(401, 'invalid_signature', 'Recall webhook signature verification failed')
  let event: RecallEvent

  try {
    event = JSON.parse(body) as RecallEvent
  } catch {
    throw new AppError(400, 'invalid_payload', 'Webhook body is not valid JSON')
  }
  void handleRecallEvent(id, event).catch((error: unknown) => {
    logError('meeting.webhook_failed', error, { event: event.event })
  })

  return c.body(null, 200)
})
