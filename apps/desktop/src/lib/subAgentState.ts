import { openInputRequests } from './agentInputRequests.ts'
import { chatRowIndicator } from './runtimeExecution.ts'

import type { RuntimeExecution } from './runtimeExecution.ts'
import type { AgentConversation } from '../api/agent-types.ts'

/** Where a sub-agent stands: asking the user, working, or finished. */
export type SubAgentState = 'waiting' | 'running' | 'done'

/**
 * An open question outranks a running turn or background work; a thread
 * doing neither is done, a stopped or disconnected runtime included.
 */
export function subAgentState(
  conversation: Pick<AgentConversation, 'inputRequests' | 'pendingDecision'>,
  runtimeState: RuntimeExecution | undefined,
): SubAgentState {
  if (openInputRequests(conversation).length > 0) return 'waiting'
  const indicator = chatRowIndicator(runtimeState, false)

  return indicator === 'turn' || indicator === 'background' ? 'running' : 'done'
}

/** Waiting or running: what a list of sub-agents keeps in view. */
export function isSubAgentActive(
  conversation: Pick<AgentConversation, 'inputRequests' | 'pendingDecision'>,
  runtimeState: RuntimeExecution | undefined,
): boolean {
  return subAgentState(conversation, runtimeState) !== 'done'
}
