import { trackAgentProducer } from '@/lib/agent/producer-drain'

import { executeAgentForTrigger } from './trigger-run-execute'

import type { TriggerRunParams } from './trigger-run-execute'

export type { TriggerRunParams, AgentRunFrameSink } from './trigger-run-execute'

export function runAgentForTrigger(params: TriggerRunParams) {
  return trackAgentProducer(() => executeAgentForTrigger(params))
}
