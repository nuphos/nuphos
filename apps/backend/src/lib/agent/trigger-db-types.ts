import type { AgentCredentialAccess } from './db'
import type { MonitoringIdentity } from './monitoring-workflow'
import type { TriggerCredentialMode } from './trigger-credential-access'
import type { MonitoringProviderWiring, TriggerCleanupStatus } from './trigger-provider-wiring'
import type { SlackOutboundDestination } from '@/lib/slack/destinations'
import type { ObjectId } from 'mongodb'

export type TriggerType = 'cron' | 'webhook'

/**
 * Who created the trigger. 'user' = the desktop/web UI (and legacy rows with
 * no value), 'agent' = the agent's trigger_* tools in a conversation.
 * 'automation' has no current writer; it stays readable for stored rows.
 */
export type TriggerSource = 'user' | 'agent' | 'automation'
export type TriggerExecutionAuthorizationStatus = 'unchecked' | 'valid' | 'invalid'

export type TriggerSourceContext = {
  /** Agent conversation that created the trigger (jump back to the journal). */
  sessionId?: string
}

export type AgentTrigger = {
  _id?: ObjectId
  /** Legacy owner field retained for compatibility; new team ownership is keyed by teamId. */
  userId: string
  teamId?: string
  /** Immutable audit identity of the user who created this trigger. */
  createdByUserId?: string
  /**
   * User whose credentials and permissions every run must use. A substantive
   * edit deliberately rebinds this to the editor after the directional role
   * check, while rename and enable/disable leave it unchanged.
   */
  executionPrincipalUserId?: string
  /**
   * `all` resolves the principal's credentials at run time; `selected` pins
   * the scope in `executionCredentialAccess`. Absent on rows written before
   * the field existed, which read as `all`.
   */
  credentialMode?: TriggerCredentialMode
  /**
   * The connector scope the user picked. Only meaningful under
   * `credentialMode: 'selected'`, where runtime access is this scope
   * intersected with the principal's current access.
   */
  executionCredentialAccess?: AgentCredentialAccess
  executionAuthorizationStatus?: TriggerExecutionAuthorizationStatus
  executionAuthorizationCheckedAt?: Date
  executionAuthorizationError?: string
  name: string
  triggerType: TriggerType
  cronExpression?: string
  webhookSecret?: string
  messageTemplate: string
  enabled: boolean
  source?: TriggerSource
  sourceContext?: TriggerSourceContext
  /** Auto-disable after this time (hourly expiry sweep). */
  expiresAt?: Date
  /** Idempotency key for automation callers: create with the same key returns the existing trigger. */
  dedupeKey?: string
  /** Immutable provider/resource identity used to dedupe and finalize a managed Watch safely. */
  monitoringIdentity?: MonitoringIdentity
  /** Optional management layer for one shared provider/integration ingress. */
  watchGroupId?: ObjectId
  /** Stable provider/integration partition served by this shared ingress. */
  watchGroupPartitionKey?: string
  /** Exact members accepted by this ingress. */
  watchGroupMemberKeys?: string[]
  /** Persisted migration marker for managed Watches created before monitoringIdentity existed. */
  legacyMonitoringProvider?: string
  /** Internal cursor proving the legacy Watch provider migration inspected this row. */
  legacyProviderChecked?: true
  /**
   * Minimum seconds between webhook-triggered runs (flood guard). Unset falls
   * back to config.agent.triggers.webhookCooldownSeconds; 0 disables. Cron
   * runs are already rate-bound by their schedule and manual test-fires are
   * user-initiated, so only webhook deliveries consult this.
   */
  minIntervalSeconds?: number
  /**
   * Treat Slack delivery as one stateful incident: one root, material updates
   * in-thread, one resolution. Explicit opt-in so generic webhooks and cron
   * notifications keep their independent-message semantics.
   */
  incidentMode?: boolean
  /** Exact Slack destination approved when this incident workflow was created. */
  slackDestination?: SlackOutboundDestination
  /**
   * Optimistic fence for execution-affecting edits. Legacy rows without this
   * field are revision 0; new triggers start at revision 1.
   */
  configRevision?: number
  /**
   * Secret-free ownership receipt written only after the provider-side Watch
   * has been wired, read back, and drill-tested. It lets deletion be a
   * deterministic backend operation instead of another Agent conversation.
   */
  providerWiring?: MonitoringProviderWiring
  /** When provider wiring was read back, drill-tested, and finalized. */
  providerWiringFinalizedAt?: Date
  /** Present only while a managed Watch is being removed or needs a retry. */
  cleanupStatus?: TriggerCleanupStatus
  cleanupError?: string
  cleanupStartedAt?: Date
  cleanupUpdatedAt?: Date
  lastRunAt?: Date
  createdAt: Date
  updatedAt: Date
}
