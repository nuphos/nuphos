import { AppError } from '@/lib/errors'

import { assertTriggerAccess } from '../trigger-access'
import { agentTriggers, generateWebhookSecret } from '../trigger-db'
import { changedBy, writeTrigger } from '../trigger-history'

import { findManagedTrigger, parseTriggerId } from './shared'

import type { TriggerActor } from '../trigger-access'

/**
 * Give a webhook Trigger a new secret and return it; it is not shown again. Each delivery reads
 * the Trigger afresh, so the old secret is refused from the next delivery on. The history records
 * who rotated it and when, never the secret.
 */
export async function rotateTriggerSecret(triggerId: string, actor: TriggerActor): Promise<string> {
  const _id = parseTriggerId(triggerId)
  const trigger = await findManagedTrigger(_id)

  await assertTriggerAccess(trigger, actor, 'manage')
  if (trigger.triggerType !== 'webhook') {
    throw new AppError(400, 'not_webhook', 'Only a webhook Trigger has a secret')
  }
  const webhookSecret = generateWebhookSecret()
  const written = await writeTrigger(
    {
      before: trigger,
      after: { ...trigger, webhookSecret },
      by: changedBy(actor),
      reason: 'webhook_secret_rotated',
    },
    async (session) =>
      (
        await agentTriggers().updateOne(
          { _id },
          { $set: { webhookSecret, updatedAt: new Date() } },
          { session },
        )
      ).matchedCount > 0,
  )

  if (!written) throw new AppError(404, 'not_found', 'Trigger not found')

  return webhookSecret
}
