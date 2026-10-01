import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { config } from '@/config'
import { agentTriggers, verifyWebhookSecret } from '@/lib/agent/trigger-db'
import { executeTrigger } from '@/lib/agent/trigger-executor'
import {
  claimTriggerGroupMemberRun,
  matchTriggerGroupMembers,
  triggerGroupIncidentScope,
} from '@/lib/agent/trigger-group-service'
import { parseMonitoringProviderWiring } from '@/lib/agent/trigger-provider-wiring'
import { shouldBypassTriggerCooldown } from '@/lib/agent/webhook-cooldown'
import {
  AwsSnsValidationError,
  confirmAwsSnsSubscription,
  isAwsSnsValidationError,
  normalizeCloudWatchSnsNotification,
  parseAwsSnsEnvelope,
  shouldHandleAwsSnsRequest,
  verifyAwsSnsSignature,
} from '@/lib/aws/sns-webhook'
import { AppError } from '@/lib/errors'
import { logError } from '@/lib/observability'

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

  // Parse before claiming the flood-guard window so terminal incident
  // deliveries can bypass it. Exact-once recovery posting is enforced by the
  // incident store in the executor, so concurrent duplicate recoveries remain
  // safe while a real recovery can never be lost behind a recent firing run.
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

  const payloadType =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>).Type
      : undefined
  const triggerProvider =
    trigger.monitoringIdentity?.provider ??
    (trigger.providerWiring?.provider === 'watch_group'
      ? trigger.providerWiring.providerKey
      : undefined)

  if (
    shouldHandleAwsSnsRequest({
      headerMessageType: snsMessageType,
      payloadType,
      triggerProvider,
    })
  ) {
    if (triggerProvider !== 'aws') {
      throw new AppError(400, 'unexpected_sns_message', 'This trigger is not an AWS Watch')
    }
    let envelope

    try {
      envelope = parseAwsSnsEnvelope(payload)
      if (snsMessageType && snsMessageType !== envelope.Type) {
        throw new AwsSnsValidationError('SNS message type header does not match the signed body')
      }

      const receipt = trigger.providerWiring
        ? parseMonitoringProviderWiring(trigger.providerWiring)
        : undefined
      const awsReceipts =
        receipt?.provider === 'watch_group'
          ? receipt.wirings.filter((wiring) => wiring.provider === 'aws')
          : receipt?.provider === 'aws'
            ? [receipt]
            : []

      if (receipt && awsReceipts.length === 0) {
        throw new AwsSnsValidationError('AWS notification does not match the provider receipt')
      }
      await verifyAwsSnsSignature(envelope, {
        expectedTopicArn:
          awsReceipts.length > 0 &&
          awsReceipts.every((item) => item.snsTopicArn === awsReceipts[0]!.snsTopicArn)
            ? awsReceipts[0]!.snsTopicArn
            : undefined,
      })

      if (envelope.Type === 'SubscriptionConfirmation') {
        await confirmAwsSnsSubscription(envelope)

        return c.json({ ok: true, reason: 'sns_subscription_confirmed' }, 200)
      }
      if (envelope.Type === 'UnsubscribeConfirmation') {
        return c.json({ ok: true, reason: 'sns_unsubscribe_confirmed' }, 200)
      }
      // The receipt is the trust boundary between a signed SNS topic and the
      // exact alarm wiring this Watch owns. Subscription confirmation is
      // allowed while setup is in progress, but notifications do not execute
      // until trigger_finalize_wiring persisted and validated that receipt.
      if (!receipt || awsReceipts.length === 0) {
        return c.json({ ok: false, reason: 'provider_wiring_incomplete' }, 200)
      }
      const normalizedPayload = normalizeCloudWatchSnsNotification(envelope)

      if (
        !awsReceipts.some(
          (item) =>
            normalizedPayload.alarm.name === item.alarmName &&
            normalizedPayload.alarm.arn === item.alarmArn,
        )
      ) {
        throw new AwsSnsValidationError(
          'SNS notification does not match the CloudWatch alarm owned by this trigger',
        )
      }
      if (normalizedPayload.status === 'unknown') {
        return c.json({ ok: true, skipped: true, reason: 'unsupported_alarm_state' }, 200)
      }
      payload = normalizedPayload
    } catch (error) {
      logError('webhook.aws_sns_validation_failed', error, { trigger_id: triggerId })
      if (isAwsSnsValidationError(error)) {
        throw new AppError(401, 'invalid_sns_message', 'AWS SNS message verification failed')
      }
      // SNS retries 5xx responses, but generally treats 4xx as terminal. Keep
      // certificate-fetch and subscription-confirmation outages retryable so a
      // transient network failure cannot silently drop the Watch delivery.
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

  if (trigger.watchGroupId) {
    const members = await matchTriggerGroupMembers({
      triggerId: trigger._id!,
      source: c.req.query('source'),
      payload,
    })

    if (members.length === 0) {
      return c.json({ ok: true, skipped: true, reason: 'group_member_not_selected' }, 200)
    }
    const cooldownSeconds =
      trigger.minIntervalSeconds ?? config.agent.triggers.webhookCooldownSeconds
    let accepted = 0

    for (const match of members) {
      const { member, payload: memberPayload } = match
      const canRun =
        shouldBypassTriggerCooldown(trigger.incidentMode, memberPayload) ||
        (await claimTriggerGroupMemberRun({
          groupId: trigger.watchGroupId,
          memberKey: member.key,
          cooldownSeconds,
        }))

      if (!canRun) continue
      accepted += 1
      const incidentScope = triggerGroupIncidentScope(member.key)

      void executeTrigger(trigger, memberPayload, {
        incidentScope,
        groupMember: member,
        runKind: 'webhook',
      }).catch((err: unknown) => {
        logError('webhook.trigger_group_execution_failed', err, {
          trigger_id: triggerId,
          member_key: member.key,
        })
      })
    }

    return c.json({
      ok: true,
      matched: members.length,
      accepted,
      ...(accepted === 0 ? { reason: 'rate_limited' } : {}),
    })
  }

  // Flood guard: every accepted delivery starts a full agent session, so a
  // flapping alert or a sender retry storm must not translate 1:1 into
  // sessions. Claim the run window atomically on lastRunAt — concurrent
  // deliveries race on the same document and exactly one wins. Rate-limited
  // deliveries get 200 (like trigger_disabled) so senders don't treat it as
  // a failure and retry, which would amplify the very storm being damped.
  const cooldownSeconds = trigger.minIntervalSeconds ?? config.agent.triggers.webhookCooldownSeconds

  if (cooldownSeconds > 0 && !shouldBypassTriggerCooldown(trigger.incidentMode, payload)) {
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
