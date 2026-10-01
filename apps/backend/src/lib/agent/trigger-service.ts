/**
 * Single source of truth for trigger lifecycle operations. Three consumers —
 * the REST routes (desktop UI), the agent's trigger_* tools, and automation
 * (monitoring incidents) — all go through here so validation, secret
 * generation, BullMQ scheduling, rollback, and the per-owner quota are
 * enforced identically no matter who is calling.
 */
export { performTriggerCleanup } from './trigger-service/cleanup'
export { createTrigger } from './trigger-service/create'
export { deleteTrigger } from './trigger-service/delete'
export type { DeleteTriggerResult } from './trigger-service/delete'
export { finalizeTriggerProviderWiring } from './trigger-service/finalize-wiring'
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
export {
  assertTransferTargetIsMember,
  executionPrincipalAssignment,
  transferTriggerExecutionPrincipal,
} from './trigger-service/transfer'
export { updateTrigger } from './trigger-service/update'
