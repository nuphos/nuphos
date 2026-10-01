import { ObjectId } from 'mongodb'

import { AppError } from '@/lib/errors'

import type { CreateTriggerInput } from './shared'

export function validateCreateTriggerShape(input: CreateTriggerInput): void {
  if (input.triggerType !== 'cron' && input.triggerType !== 'webhook') {
    throw new AppError(400, 'invalid_request', 'triggerType must be "cron" or "webhook"')
  }
  if (input.monitoringIdentity && input.triggerType !== 'webhook') {
    throw new AppError(
      400,
      'invalid_monitoring_identity',
      'monitoringIdentity is only valid for webhook Watches',
    )
  }
  if (input.monitoringIdentity && input.dedupeKey) {
    throw new AppError(
      400,
      'invalid_monitoring_identity',
      'Use monitoringIdentity or dedupeKey, not both',
    )
  }
  if (input.watchGroup) {
    if (
      input.triggerType !== 'webhook' ||
      !ObjectId.isValid(input.watchGroup.groupId) ||
      input.watchGroup.memberKeys.length === 0
    ) {
      throw new AppError(
        400,
        'invalid_trigger_group_ingress',
        'A Watch Group ingress requires a webhook, valid group id, and members',
      )
    }
  }
}
