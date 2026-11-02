import { openInputRequests } from './agentInputRequests.ts'
import { chatRowIndicator } from './runtimeExecution.ts'

import type { ChatRowIndicator, RuntimeExecution } from './runtimeExecution.ts'
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

/** A run that failed, not one the user stopped: its row shows the alert icon. */
export function subAgentRunFailed(runtimeState: RuntimeExecution | undefined): boolean {
  return ['failed', 'resume_failed'].includes(runtimeState?.phase ?? '')
}

/** Why a row carries its dot, if it does. */
export type RowDot = 'unread' | 'waiting' | null

/**
 * A top level chat's dot is its unread reply. A thread talks through its
 * parent, so its unread state means nothing: only an open question, which the
 * parent cannot resolve on its own, gives it a dot.
 */
export function rowDot(
  conversation: Pick<AgentConversation, 'parentSessionId' | 'inputRequests' | 'pendingDecision'>,
  runtimeState: RuntimeExecution | undefined,
  unread: boolean,
): RowDot {
  if (!conversation.parentSessionId) return unread ? 'unread' : null

  return subAgentState(conversation, runtimeState) === 'waiting' ? 'waiting' : null
}

/**
 * The mark a row shows. An open question outranks work, since a thread asking
 * while it works is still blocked on the viewer, but not a failed run.
 */
export function rowIndicator(
  runtimeState: RuntimeExecution | undefined,
  dot: RowDot,
): ChatRowIndicator | 'waiting' {
  const indicator = chatRowIndicator(runtimeState, dot === 'unread')

  return dot === 'waiting' && indicator !== 'error' ? 'waiting' : indicator
}
