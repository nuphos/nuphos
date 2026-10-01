import { randomUUID } from 'node:crypto'

import { AppError } from '@/lib/errors'
import { logError } from '@/lib/observability'
import { createSlackOutboundContext } from '@/lib/slack/agent-outbound'

import { assertTriggerAccess, triggerExecutionPrincipalId } from '../trigger-access'
import { executeTrigger } from '../trigger-executor'

import { findManagedTrigger, parseTriggerId } from './shared'

import type { TriggerActor } from '../trigger-access'

/**
 * Fire a trigger now for verification. Fire-and-forget, matching the public
 * /webhooks/:id endpoint — returning means execution kicked off in the
 * background, NOT that the agent turn finished (which can take minutes).
 * `payloadOverride` substitutes the webhook payload; cron triggers ignore it.
 */
export async function testFireTrigger(
  triggerId: string,
  actor: TriggerActor,
  payloadOverride?: unknown,
): Promise<{ name: string }> {
  const trigger = await findManagedTrigger(parseTriggerId(triggerId))

  await assertTriggerAccess(trigger, actor, 'manage')

  const payload =
    trigger.triggerType === 'webhook'
      ? (payloadOverride ?? { event: 'test_fire', firedAt: new Date().toISOString() })
      : undefined

  void executeTrigger(trigger, payload, { runKind: 'manual' }).catch((err: unknown) => {
    logError('agent.trigger.test_fire_failed', err, { trigger_id: triggerId })
  })

  return { name: trigger.name }
}

export type TestTriggerDestinationResult = {
  ok: true
  delivery: 'slack' | 'nuphos'
  destinationLabel?: string
}

/**
 * Verify the destination configured by the desktop UI without manufacturing a
 * provider alert or entering incident investigation/dedupe. Real provider
 * webhooks and the agent-facing trigger_test_fire tool continue to use
 * executeTrigger via testFireTrigger.
 *
 * Legacy/Nuphos-only triggers do not have a separately addressable outbound
 * destination, so they retain the existing background agent verification.
 */
export async function testTriggerDestination(
  triggerId: string,
  actor: TriggerActor,
  payloadOverride?: unknown,
): Promise<TestTriggerDestinationResult> {
  const trigger = await findManagedTrigger(parseTriggerId(triggerId))

  await assertTriggerAccess(trigger, actor, 'manage')

  if (!trigger.slackDestination) {
    const payload =
      trigger.triggerType === 'webhook'
        ? (payloadOverride ?? { event: 'test_fire', firedAt: new Date().toISOString() })
        : undefined

    void executeTrigger(trigger, payload, { runKind: 'manual' }).catch((err: unknown) => {
      logError('agent.trigger.test_fire_failed', err, { trigger_id: triggerId })
    })

    return { ok: true, delivery: 'nuphos' }
  }

  const slack = await createSlackOutboundContext({
    userId: triggerExecutionPrincipalId(trigger),
    conversationId: randomUUID(),
    teamId: trigger.teamId,
  })

  if (!slack) {
    throw new AppError(
      409,
      'slack_not_connected',
      'The Slack destination stored on this Watch is no longer available',
    )
  }
  const delivery = await slack.post({
    destination: trigger.slackDestination,
    text:
      `🧪 Test notification from Nuphos Trigger “${trigger.name}”.\n` +
      'The configured destination is working. This is only a delivery test; ' +
      'no incident was opened and no investigation ran.',
    bindConversation: false,
  })

  if (!delivery.ok) {
    throw new AppError(502, 'slack_test_delivery_failed', delivery.error)
  }

  return {
    ok: true,
    delivery: 'slack',
    destinationLabel: delivery.destination.label,
  }
}
