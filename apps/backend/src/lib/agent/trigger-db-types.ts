import type { AgentCredentialAccess } from './db'
import type { MonitoringIdentity } from './monitoring-workflow'
import type { SessionRouting } from './session-routing'
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
  timeZone?: string
  webhookSecret?: string
  /** Legacy: only on rows created before binding was required. Binding clears it. */
  sessionRouting?: SessionRouting
  /**
   * The existing conversation every fire is delivered into. It must belong to
   * the execution principal in the same team. Required on every new Trigger;
   * absent only on legacy rows created before that.
   */
  targetSessionId?: string
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
  /** Legacy unbound incident delivery; no longer writable. Binding clears it. */
  incidentMode?: boolean
  /** Legacy approved Slack destination for incidentMode. Binding clears it. */
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
  /** Error code of the last cleanup failure; tells the UI which way out to offer. */
  cleanupErrorCode?: string
  cleanupStartedAt?: Date
  cleanupUpdatedAt?: Date
  lastRunAt?: Date
  createdAt: Date
  updatedAt: Date
}
