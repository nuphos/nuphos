import { logError } from '@/lib/observability'

import { assertTriggerAccess } from '../trigger-access'
import { executeTrigger } from '../trigger-executor'

import { findManagedTrigger, parseTriggerId } from './shared'

import type { TriggerActor } from '../trigger-access'

/**
 * Fire a trigger now for verification: the fire is queued into its bound Task.
 * Fire-and-forget, matching the public /webhooks/:id endpoint — returning
 * means execution kicked off in the background, NOT that the agent turn
 * finished (which can take minutes).
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
