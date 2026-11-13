/**
 * Single source of truth for trigger lifecycle operations. The REST routes
 * (desktop UI and agent sessions) and automation (bot import) all go through
 * here so validation, secret generation, BullMQ scheduling, rollback, and the
 * per-owner quota are enforced identically no matter who is calling.
 */
export { createTrigger } from './trigger-service/create'
export { deleteTrigger } from './trigger-service/delete'
export {
  assertTriggerCreationQuota,
  resolveTriggerCredentialSelection,
} from './trigger-service/quota'
export { expireTriggers, getTrigger, listTriggers } from './trigger-service/read'
export { serializeTrigger } from './trigger-service/shared'
export type {
  CreateTriggerInput,
  SerializedTrigger,
  TriggerCallerContext,
  UpdateTriggerPatch,
} from './trigger-service/shared'
export { testFireTrigger, testTriggerDestination } from './trigger-service/test-fire'
export type { TestTriggerDestinationResult } from './trigger-service/test-fire'
export { updateTrigger } from './trigger-service/update'
