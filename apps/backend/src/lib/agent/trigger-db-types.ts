import type { AgentCredentialAccess } from './db'
import type { SessionRouting } from './session-routing'
import type { TriggerCredentialMode } from './trigger-credential-access'
import type { SlackOutboundDestination } from '@/lib/slack/destinations'
import type { ObjectId } from 'mongodb'

export type TriggerType = 'cron' | 'webhook'

/**
 * Who created the trigger. 'user' = the desktop/web UI (and legacy rows with
 * no value), 'agent' = the removed agent trigger tools. 'agent' and
 * 'automation' have no current writer; they stay readable for stored rows.
 */
export type TriggerSource = 'user' | 'agent' | 'automation'
export type TriggerExecutionAuthorizationStatus = 'unchecked' | 'valid' | 'invalid'

export type TriggerSourceContext = {
  /** Agent conversation that created the trigger (jump back to the journal). */
  sessionId?: string
}

export type AgentTrigger = {
  _id?: ObjectId
  /**
   * Owner of the Task the Trigger belongs to, copied when it is created there.
   * The Trigger runs as this user and only this user may change it.
   */
  userId: string
  teamId?: string
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
  lastRunAt?: Date
  /** When a scheduled fire last reached the worker, whatever the turn's outcome. */
  lastFiredAt?: Date
  /** Scheduled time of the latest fire that never ran; unset by the next fire. */
  missedRunAt?: Date
  createdAt: Date
  updatedAt: Date
}
