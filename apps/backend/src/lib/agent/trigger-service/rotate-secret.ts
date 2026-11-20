import { AppError } from '@/lib/errors'

import { assertTriggerAccess } from '../trigger-access'
import { agentTriggers, generateWebhookSecret } from '../trigger-db'

import { findManagedTrigger, parseTriggerId } from './shared'

import type { TriggerActor } from '../trigger-access'

/**
 * Give a webhook Trigger a new secret and return it; it is not shown again. Each delivery reads
 * the Trigger afresh, so the old secret is refused from the next delivery on.
 */
export async function rotateTriggerSecret(triggerId: string, actor: TriggerActor): Promise<string> {
  const _id = parseTriggerId(triggerId)
  const trigger = await findManagedTrigger(_id)

  await assertTriggerAccess(trigger, actor, 'manage')
  if (trigger.triggerType !== 'webhook') {
    throw new AppError(400, 'not_webhook', 'Only a webhook Trigger has a secret')
  }
  const webhookSecret = generateWebhookSecret()
  const { matchedCount } = await agentTriggers().updateOne(
    { _id },
    { $set: { webhookSecret, updatedAt: new Date() } },
  )

  if (matchedCount === 0) throw new AppError(404, 'not_found', 'Trigger not found')

  return webhookSecret
}
