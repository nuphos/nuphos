import * as agent from '../agent'

export const agentTriggerChannels = {
  'agent:listTriggers': (_e: unknown, teamId?: string, targetSessionId?: string) =>
    agent.listAgentTriggers(teamId, targetSessionId),
  'agent:getTrigger': (_e: unknown, triggerId: string, teamId?: string) =>
    agent.getAgentTrigger(triggerId, teamId),
  'agent:updateTrigger': (
    _e: unknown,
    triggerId: string,
    patch: agent.UpdateAgentTriggerInput,
    teamId?: string,
  ) => agent.updateAgentTrigger(triggerId, patch, teamId),
  'agent:deleteTrigger': (_e: unknown, triggerId: string, teamId?: string) =>
    agent.deleteAgentTrigger(triggerId, teamId),
} as const
