import { callJson, teamQuery } from './http'

export type AgentTriggerType = 'cron' | 'webhook'

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
    ownership: 'created' | 'modified' | 'referenced'
    cleanupAction: 'delete' | 'detach' | 'restore' | 'preserve' | 'manual'
    description: string
  }[]
  cleanupSteps: {
    action: 'disable' | 'delete' | 'detach' | 'restore' | 'preserve' | 'manual'
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
  cleanupStatus?: 'deleting' | 'cleanup_failed'
  cleanupError?: string
  cleanupStartedAt?: string
  cleanupUpdatedAt?: string
  lastRunAt?: string
  createdAt: string
  updatedAt: string
  // Only populated on the single-trigger GET and the create POST. Stripped
  // from list responses to avoid shipping 100 secrets on every refresh.
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
  slackDestination?: { type: 'dm_self' } | { type: 'channel'; channelId: string }
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
}

export type UpdateAgentTriggerInput = {
  name?: string
  messageTemplate?: string
  cronExpression?: string
  enabled?: boolean
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

export async function listAgentTriggers(teamId?: string): Promise<AgentTrigger[]> {
  return callJson<AgentTrigger[]>('GET', `/agent/triggers${teamQuery(teamId)}`)
}

export async function listAgentTriggerGroups(teamId?: string): Promise<AgentTriggerGroup[]> {
  return callJson<AgentTriggerGroup[]>('GET', `/agent/triggers/groups${teamQuery(teamId)}`)
}

export async function updateAgentTriggerGroup(
  groupId: string,
  patch: UpdateAgentTriggerGroupInput,
  teamId: string,
): Promise<AgentTriggerGroup> {
  return callJson<AgentTriggerGroup>(
    'PATCH',
    `/agent/triggers/groups/${encodeURIComponent(groupId)}`,
    { ...patch, teamId },
  )
}

export async function testFireAgentTriggerGroup(
  groupId: string,
  teamId: string,
): Promise<TestAgentTriggerGroupResult> {
  return callJson<TestAgentTriggerGroupResult>(
    'POST',
    `/agent/triggers/groups/${encodeURIComponent(groupId)}/test-fire${teamQuery(teamId)}`,
  )
}

export async function getAgentTrigger(triggerId: string, teamId?: string): Promise<AgentTrigger> {
  return callJson<AgentTrigger>(
    'GET',
    `/agent/triggers/${encodeURIComponent(triggerId)}${teamQuery(teamId)}`,
  )
}

export async function createAgentTrigger(input: CreateAgentTriggerInput): Promise<AgentTrigger> {
  return callJson<AgentTrigger>('POST', `/agent/triggers`, input)
}

export async function updateAgentTrigger(
  triggerId: string,
  patch: UpdateAgentTriggerInput,
  teamId?: string,
): Promise<AgentTrigger> {
  return callJson<AgentTrigger>(
    'PATCH',
    `/agent/triggers/${encodeURIComponent(triggerId)}${teamQuery(teamId)}`,
    patch,
  )
}

export async function deleteAgentTrigger(
  triggerId: string,
  teamId?: string,
): Promise<DeleteAgentTriggerResult> {
  return callJson<DeleteAgentTriggerResult>(
    'DELETE',
    `/agent/triggers/${encodeURIComponent(triggerId)}${teamQuery(teamId)}`,
  )
}

export async function transferAgentTriggerExecutionPrincipal(
  triggerId: string,
  userId: string,
  teamId?: string,
): Promise<AgentTrigger> {
  return callJson<AgentTrigger>(
    'POST',
    `/agent/triggers/${encodeURIComponent(triggerId)}/execution-principal${teamQuery(teamId)}`,
    { userId },
  )
}

export async function transferAgentTriggerGroupExecutionPrincipal(
  groupId: string,
  userId: string,
  teamId?: string,
): Promise<AgentTriggerGroup> {
  return callJson<AgentTriggerGroup>(
    'POST',
    `/agent/triggers/groups/${encodeURIComponent(groupId)}/execution-principal${teamQuery(teamId)}`,
    { userId },
  )
}

export async function testFireAgentTrigger(
  triggerId: string,
  // Deliberately not `unknown`: this used to be, and a call site quietly
  // passed the teamId here — the request then carried no team scope at all and
  // the fire failed with nothing to show for it.
  payload?: Record<string, unknown>,
  teamId?: string,
): Promise<TestAgentTriggerResult> {
  return callJson<TestAgentTriggerResult>(
    'POST',
    `/agent/triggers/${encodeURIComponent(triggerId)}/test-fire${teamQuery(teamId)}`,
    payload !== undefined ? { payload } : {},
  )
}

export type TriggerSchedulerStatus = { cronEnabled: boolean }

export async function getTriggerSchedulerStatus(): Promise<TriggerSchedulerStatus> {
  return callJson<TriggerSchedulerStatus>('GET', `/agent/triggers/scheduler-status`)
}
