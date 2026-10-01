export type AgentTriggerType = 'cron' | 'webhook'
export type AgentTriggerSlackDestination =
  { type: 'dm_self' } | { type: 'channel'; channelId: string }

// Who created the trigger: absent/'user' = this UI, 'agent' = the agent's
// trigger_* tools in a conversation. 'automation' only appears on older rows.
export type AgentTriggerSource = 'user' | 'agent' | 'automation'
export type AgentTriggerCleanupStatus = 'deleting' | 'cleanup_failed'
export type ManagedProviderResourceOwnership = 'created' | 'modified' | 'referenced'
export type ManagedProviderCleanupAction = 'delete' | 'detach' | 'restore' | 'preserve' | 'manual'
export type ManagedProviderCleanupStepAction =
  'disable' | 'delete' | 'detach' | 'restore' | 'preserve' | 'manual'

export type ManagedProviderResourcePlan = {
  provider: string
  providerLabel?: string
  cleanupMode?: 'automatic' | 'manual'
  integrationLabel?: string
  recordedAt?: string
  resources: {
    kind: string
    name: string
    id: string
    url?: string
    ownership: ManagedProviderResourceOwnership
    cleanupAction: ManagedProviderCleanupAction
    description: string
  }[]
  cleanupSteps: {
    action: ManagedProviderCleanupStepAction
    description: string
    resourceId?: string
  }[]
}

export type AgentTrigger = {
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
  messageTemplate: string
  enabled: boolean
  source?: AgentTriggerSource
  sourceContext?: { sessionId?: string }
  // Auto-disable time (expiry sweep) — set on time-boxed / automation triggers.
  expiresAt?: string
  // Webhook flood guard: min seconds between runs (unset = server default).
  minIntervalSeconds?: number
  incidentMode?: boolean
  slackDestination?: AgentTriggerSlackDestination
  watchGroupId?: string
  watchGroupPartitionKey?: string
  watchGroupMemberKeys?: string[]
  providerWiring?: {
    provider: 'grafana' | 'gcp' | 'betterstack' | 'aws' | 'generic' | 'watch_group'
  }
  providerWiringFinalizedAt?: string
  managedProviderResources?: ManagedProviderResourcePlan
  providerHint?: string
  requiresProviderCleanup?: boolean
  cleanupStatus?: AgentTriggerCleanupStatus
  cleanupError?: string
  cleanupStartedAt?: string
  cleanupUpdatedAt?: string
  lastRunAt?: string
  createdAt: string
  updatedAt: string
  // Present only on the single-trigger GET and the create POST; stripped from
  // list responses to avoid shipping every secret on every refresh.
  webhookSecret?: string
}

export type AgentTriggerGroup = {
  id: string
  userId: string
  createdByUserId?: string
  executionPrincipalUserId?: string
  executionAuthorizationStatus?: 'unchecked' | 'valid' | 'invalid'
  executionAuthorizationCheckedAt?: string
  executionAuthorizationError?: string
  teamId: string
  name: string
  messageTemplate: string
  memberKeys: string[]
  expectedMemberCount: number
  partitionCount: number
  readyPartitionCount: number
  failedPartitionCount: number
  partitions: {
    key: string
    provider: string
    integrationId: string
    memberKeys: string[]
    triggerId: string
  }[]
  slackDestination?: AgentTriggerSlackDestination
  enabled: boolean
  state: 'provisioning' | 'active' | 'partial' | 'paused'
  createdAt: string
  updatedAt: string
}

export type CreateAgentTriggerInput = {
  name: string
  triggerType: AgentTriggerType
  messageTemplate: string
  cronExpression?: string
  teamId?: string
  incidentMode?: boolean
  slackDestination?: AgentTriggerSlackDestination
}

export type UpdateAgentTriggerInput = {
  name?: string
  messageTemplate?: string
  cronExpression?: string
  enabled?: boolean
  incidentMode?: boolean
  slackDestination?: AgentTriggerSlackDestination | null
}

export type UpdateAgentTriggerGroupInput = {
  name?: string
  messageTemplate?: string
  enabled?: boolean
}

export type TestAgentTriggerGroupResult = {
  ok: true
  verifiedIngressCount: number
  verifiedMemberCount: number
  delivery: 'slack' | 'nuphos'
  destinationLabel?: string
}

export type TestAgentTriggerResult = {
  ok: true
  delivery: 'slack' | 'nuphos'
  destinationLabel?: string
}

export type DeleteAgentTriggerResult =
  { ok: true; deleted: true } | { ok: true; deleted: false; trigger: AgentTrigger }

export type TriggerSchedulerStatus = { cronEnabled: boolean }
