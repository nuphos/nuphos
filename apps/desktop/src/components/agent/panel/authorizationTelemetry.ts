import { track } from '../../../lib/analytics'
import { CLIENT_SIDE_LOCAL_TOOLS } from '../../../lib/clientToolPhase'

import type { Message } from './model'
import type { AuthorizationDecisionAction, ToolPart } from './parts'

/**
 * Call this only once the decision is authoritative: the caller's catch lets
 * the user decide again, so an earlier emit double-counts — the rule the bypass
 * toggle already follows in usePanelPermissions.
 */
export function trackAuthorizationDecision(args: {
  messages: Message[]
  toolCallId: string
  sessionId: string
  decision: AuthorizationDecisionAction
  approved: boolean
}): void {
  const { approved, decision, messages, sessionId, toolCallId } = args
  const decidedPart = messages
    .flatMap((m) => m.parts)
    .find((p): p is ToolPart => p.type === 'tool' && p.toolCallId === toolCallId)

  track('agent_authorization_decided', {
    decision,
    approved,
    tool_name: decidedPart?.toolName,
    is_client_tool: decidedPart ? CLIENT_SIDE_LOCAL_TOOLS.has(decidedPart.toolName) : undefined,
    session_id: sessionId,
  })
}
