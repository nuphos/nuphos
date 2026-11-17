import { callJson, callJsonForRenderer, teamQuery } from './http'

export type AgentTriggerType = 'cron' | 'webhook'

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

export type DeleteAgentTriggerResult = { ok: true; deleted: true }

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
): Promise<DeleteAgentTriggerResult> {
  return callJson<DeleteAgentTriggerResult>(
    'DELETE',
    `/agent/triggers/${encodeURIComponent(triggerId)}${teamQuery(teamId)}`,
  )
}
