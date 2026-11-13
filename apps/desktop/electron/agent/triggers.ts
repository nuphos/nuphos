import { callJson, callJsonForRenderer, teamQuery } from './http'

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

export type UpdateAgentTriggerInput = {
  name?: string
  messageTemplate?: string
  cronExpression?: string
  targetSessionId?: string
  enabled?: boolean
}

export type DeleteAgentTriggerResult =
  { ok: true; deleted: true } | { ok: true; deleted: false; trigger: AgentTrigger }

export async function listAgentTriggers(
  teamId?: string,
  targetSessionId?: string,
): Promise<AgentTrigger[]> {
  const query = new URLSearchParams()

  if (teamId) query.set('teamId', teamId)
  if (targetSessionId) query.set('targetSessionId', targetSessionId)

  return callJson<AgentTrigger[]>('GET', `/agent/triggers?${query.toString()}`)
}

export async function getAgentTrigger(triggerId: string, teamId?: string): Promise<AgentTrigger> {
  return callJson<AgentTrigger>(
    'GET',
    `/agent/triggers/${encodeURIComponent(triggerId)}${teamQuery(teamId)}`,
  )
}

export async function updateAgentTrigger(
  triggerId: string,
  patch: UpdateAgentTriggerInput,
  teamId?: string,
): Promise<AgentTrigger> {
  return callJsonForRenderer<AgentTrigger>(
    'PATCH',
    `/agent/triggers/${encodeURIComponent(triggerId)}${teamQuery(teamId)}`,
    patch,
  )
}

export async function deleteAgentTrigger(
  triggerId: string,
  teamId?: string,
  withoutProviderCleanup = false,
): Promise<DeleteAgentTriggerResult> {
  const path = `/agent/triggers/${encodeURIComponent(triggerId)}${teamQuery(teamId)}`
  const separator = teamId ? '&' : '?'

  return callJson<DeleteAgentTriggerResult>(
    'DELETE',
    withoutProviderCleanup ? `${path}${separator}withoutProviderCleanup=true` : path,
  )
}
