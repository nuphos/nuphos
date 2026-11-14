export type AgentTriggerType = 'cron' | 'webhook'

// Who created the trigger: absent/'user' = this UI or the API. 'agent' (the
// removed agent trigger tools) and 'automation' only appear on older rows.
export type AgentTriggerSource = 'user' | 'agent' | 'automation'
export type AgentTrigger = {
  scheduleDescription?: string
  canDelete?: boolean
  canManage?: boolean
  nextRunAt?: string | null
  id: string
  userId: string
  createdByUserId?: string
  executionPrincipalUserId?: string
  executionAuthorizationStatus?: 'unchecked' | 'valid' | 'invalid'
  executionAuthorizationCheckedAt?: string
  executionAuthorizationError?: string
  teamId?: string
  name: string
  triggerType: AgentTriggerType
  cronExpression?: string
  timeZone?: string
  /** Every fire is delivered into this conversation instead of a new one. */
  targetSessionId?: string
  /** Present on webhook triggers that route to a session per resource. */
  sessionRouting?: object
  messageTemplate: string
  enabled: boolean
  source?: AgentTriggerSource
  sourceContext?: { sessionId?: string }
  // Auto-disable time (expiry sweep) — set on time-boxed / automation triggers.
  expiresAt?: string
  // Webhook flood guard: min seconds between runs (unset = server default).
  minIntervalSeconds?: number
  lastRunAt?: string
  /** A scheduled fire last reached the worker, whatever the turn's outcome. */
  lastFiredAt?: string
  /** Due time of the latest scheduled fire that never ran; cleared by the next fire. */
  missedRunAt?: string
  createdAt: string
  updatedAt: string
  // Present only on the single-trigger GET and the create POST; stripped from
  // list responses to avoid shipping every secret on every refresh.
  webhookSecret?: string
}

export type UpdateAgentTriggerInput = {
  name?: string
  messageTemplate?: string
  cronExpression?: string
  /** Moves delivery to another conversation; a Trigger cannot be unbound. */
  targetSessionId?: string
  enabled?: boolean
}

export type DeleteAgentTriggerResult = { ok: true; deleted: true }
