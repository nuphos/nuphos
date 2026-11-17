import { isValidTimeZone } from '@/lib/cron'
import { AppError } from '@/lib/errors'

import type { CreateTriggerInput } from './shared'

export function validateCreateTriggerShape(input: CreateTriggerInput): void {
  if (
    input.timeZone !== undefined &&
    (input.triggerType !== 'cron' || !isValidTimeZone(input.timeZone))
  )
    throw new AppError(400, 'invalid_request', 'timeZone must be an IANA zone for a cron Trigger')
  if (input.triggerType !== 'cron' && input.triggerType !== 'webhook') {
    throw new AppError(400, 'invalid_request', 'triggerType must be "cron" or "webhook"')
  }
}
