import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { config } from '@/config'
import { agentTriggers, verifyWebhookSecret } from '@/lib/agent/trigger-db'
import { executeTrigger } from '@/lib/agent/trigger-executor'
import {
  AwsSnsValidationError,
  confirmAwsSnsSubscription,
  isAwsSnsRequest,
  isAwsSnsValidationError,
  normalizeCloudWatchSnsNotification,
  parseAwsSnsEnvelope,
  verifyAwsSnsSignature,
} from '@/lib/aws/sns-webhook'
import { AppError } from '@/lib/errors'
import { logError } from '@/lib/observability'

import type { AwsSnsEnvelope, NormalizedCloudWatchSnsPayload } from '@/lib/aws/sns-webhook'

export const webhooksRoutes = new Hono()

// Public endpoint — no auth middleware. Auth is the shared secret passed in
// the `X-Webhook-Secret` header (bearer-token style), compared in constant
// time against trigger.webhookSecret. Static-header auth was chosen over HMAC
// body signing for compatibility with senders that don't natively sign
// (Grafana, Linear, Vercel, ad-hoc curl).
webhooksRoutes.post('/:triggerId', async (c) => {
  const { triggerId } = c.req.param()

  if (!ObjectId.isValid(triggerId)) throw new AppError(404, 'not_found', 'Unknown trigger')

  const trigger = await agentTriggers().findOne({ _id: new ObjectId(triggerId) })

  if (!trigger || trigger.triggerType !== 'webhook') {
    throw new AppError(404, 'not_found', 'Unknown trigger')
  }

  // Authenticate FIRST — `trigger_disabled` would otherwise let an
  // unauthenticated caller (with just a leaked URL) probe whether the
  // trigger is currently enabled.
  // Fail closed: a trigger with no secret is unauthenticated by
  // construction (corrupted record / partial migration). Refuse rather
  // than executing.
  // The secret is accepted from the `X-Webhook-Secret` header or, for senders
  // that can't set custom headers (for example, some legacy Grafana contact
  // points), a `?secret=` query parameter — the same
  // secret-in-URL convention as Slack/Discord incoming webhooks.
  const provided = c.req.header('X-Webhook-Secret') ?? c.req.query('secret') ?? ''

  if (
    !trigger.webhookSecret ||
    !provided ||
    !verifyWebhookSecret(provided, trigger.webhookSecret)
  ) {
    throw new AppError(401, 'invalid_secret', 'Webhook secret missing or incorrect')
  }

  const rawBody = await c.req.text()
  let payload: unknown
  const contentType = c.req.header('content-type') ?? ''
  const snsMessageType = c.req.header('x-amz-sns-message-type')

  if ((contentType.includes('application/json') || snsMessageType) && rawBody) {
    try {
      payload = JSON.parse(rawBody)
    } catch {
      payload = { raw: rawBody }
    }
  } else if (rawBody) {
    payload = { raw: rawBody }
  }

  // An SNS subscription is just another sender of this webhook: the secret
  // above authenticates it. The signature proves the message really came from
  // SNS before a SubscribeURL is followed or a CloudWatch alarm is trusted.
  if (isAwsSnsRequest({ headerMessageType: snsMessageType, payload })) {
    try {
      const envelope = parseAwsSnsEnvelope(payload)

      if (snsMessageType && snsMessageType !== envelope.Type) {
        throw new AwsSnsValidationError('SNS message type header does not match the signed body')
      }
      await verifyAwsSnsSignature(envelope)

      if (envelope.Type === 'SubscriptionConfirmation') {
        await confirmAwsSnsSubscription(envelope)

        return c.json({ ok: true, reason: 'sns_subscription_confirmed' }, 200)
      }
      if (envelope.Type === 'UnsubscribeConfirmation') {
        return c.json({ ok: true, reason: 'sns_unsubscribe_confirmed' }, 200)
      }
      const alarm = cloudWatchAlarm(envelope)

      if (alarm?.status === 'unknown') {
        return c.json({ ok: true, skipped: true, reason: 'unsupported_alarm_state' }, 200)
      }
      // Any other topic's notification reaches the template as the verified
      // envelope, its own Message left for the conversation to read.
      payload = alarm ?? envelope
    } catch (error) {
      logError('webhook.aws_sns_validation_failed', error, { trigger_id: triggerId })
      if (isAwsSnsValidationError(error)) {
        throw new AppError(401, 'invalid_sns_message', 'AWS SNS message verification failed')
      }
      // SNS retries 5xx responses, but generally treats 4xx as terminal. Keep
      // certificate-fetch and subscription-confirmation outages retryable so a
      // transient network failure cannot silently drop the delivery.
      throw new AppError(
        503,
        'sns_processing_unavailable',
        'AWS SNS message processing is temporarily unavailable',
      )
    }
  }

  if (!trigger.enabled) {
    return c.json({ ok: false, reason: 'trigger_disabled' }, 200)
  }

  // Flood guard: every accepted delivery starts a full agent session, so a
  // flapping alert or a sender retry storm must not translate 1:1 into
  // sessions. Claim the run window atomically on lastRunAt — concurrent
  // deliveries race on the same document and exactly one wins. Rate-limited
  // deliveries get 200 (like trigger_disabled) so senders don't treat it as
  // a failure and retry, which would amplify the very storm being damped.
  const cooldownSeconds = trigger.minIntervalSeconds ?? config.agent.triggers.webhookCooldownSeconds

  if (cooldownSeconds > 0) {
    const now = new Date()
    const cutoff = new Date(now.getTime() - cooldownSeconds * 1000)
    const claimed = await agentTriggers().findOneAndUpdate(
      {
        _id: trigger._id,
        $or: [{ lastRunAt: { $exists: false } }, { lastRunAt: { $lte: cutoff } }],
      },
      { $set: { lastRunAt: now } },
    )

    if (!claimed) {
      return c.json({ ok: false, reason: 'rate_limited', cooldownSeconds }, 200)
    }
  }

  // Fire-and-forget: respond quickly, execute in background
  void executeTrigger(trigger, payload, { runKind: 'webhook' }).catch((err: unknown) => {
    logError('webhook.trigger_execution_failed', err, { trigger_id: triggerId })
  })

  return c.json({ ok: true })
})

/** A CloudWatch alarm notification normalized for the template, or undefined for any other message. */
function cloudWatchAlarm(envelope: AwsSnsEnvelope): NormalizedCloudWatchSnsPayload | undefined {
  try {
    return normalizeCloudWatchSnsNotification(envelope)
  } catch (error) {
    if (isAwsSnsValidationError(error)) return undefined
    throw error
  }
}
