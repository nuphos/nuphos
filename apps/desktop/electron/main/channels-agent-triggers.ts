import * as agent from '../agent'

export const agentTriggerChannels = {
  'agent:listTriggers': (_e: unknown, teamId?: string, targetSessionId?: string) =>
    agent.listAgentTriggers(teamId, targetSessionId),
  'agent:listTriggerGroups': (_e: unknown, teamId?: string) => agent.listAgentTriggerGroups(teamId),
  'agent:updateTriggerGroup': (
    _e: unknown,
    groupId: string,
    patch: agent.UpdateAgentTriggerGroupInput,
    teamId: string,
  ) => agent.updateAgentTriggerGroup(groupId, patch, teamId),
  'agent:testFireTriggerGroup': (_e: unknown, groupId: string, teamId: string) =>
    agent.testFireAgentTriggerGroup(groupId, teamId),
  'agent:getTrigger': (_e: unknown, triggerId: string, teamId?: string) =>
    agent.getAgentTrigger(triggerId, teamId),
  'agent:createTrigger': (_e: unknown, input: agent.CreateAgentTriggerInput) =>
    agent.createAgentTrigger(input),
  'agent:updateTrigger': (
    _e: unknown,
    triggerId: string,
    patch: agent.UpdateAgentTriggerInput,
    teamId?: string,
  ) => agent.updateAgentTrigger(triggerId, patch, teamId),
  'agent:deleteTrigger': (
    _e: unknown,
    triggerId: string,
    teamId?: string,
    withoutProviderCleanup?: boolean,
  ) => agent.deleteAgentTrigger(triggerId, teamId, withoutProviderCleanup === true),
  'agent:testFireTrigger': (
    _e: unknown,
    triggerId: string,
    payload?: Record<string, unknown>,
    teamId?: string,
  ) => agent.testFireAgentTrigger(triggerId, payload, teamId),
  'agent:transferTriggerExecutionPrincipal': (
    _e: unknown,
    triggerId: string,
    userId: string,
    teamId?: string,
  ) => agent.transferAgentTriggerExecutionPrincipal(triggerId, userId, teamId),
  'agent:transferTriggerGroupExecutionPrincipal': (
    _e: unknown,
    groupId: string,
    userId: string,
    teamId?: string,
  ) => agent.transferAgentTriggerGroupExecutionPrincipal(groupId, userId, teamId),
  'agent:getTriggerSchedulerStatus': () => agent.getTriggerSchedulerStatus(),
} as const
