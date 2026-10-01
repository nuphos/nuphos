import { track } from '../../../lib/analytics'
import { CLIENT_SIDE_LOCAL_TOOLS } from '../../../lib/clientToolPhase'

import type { Message } from './model'
import type { AuthorizationDecisionAction, ToolPart } from './parts'

/**
 * Decisions ship raw rather than collapsed into approved/denied: 'always'
 * creates a standing rule, 'session' grants for the conversation, and that
 * gradient — how far someone lets the agent run unattended — is the signal.
 *
 * Request and effect are both sent, because a standing grant can silently fall
 * back to a one-shot (no rule text, unreadable command). `effective_decision`
 * is what the agent may do next; `decision` keeps the strength the user reached
 * for, so a gap between them shows the UI accepting what it could not deliver.
 *
 * Call this only once the decision is authoritative: the caller's catch lets
 * the user decide again, so an earlier emit double-counts — the rule the bypass
 * toggle already follows in usePanelPermissions.
 */
export function trackAuthorizationDecision(args: {
  messages: Message[]
  toolCallId: string
  sessionId: string
  decision: AuthorizationDecisionAction
  effectiveDecision: AuthorizationDecisionAction
  approved: boolean
  ruleDescription: string | undefined
}): void {
  const {
    approved,
    decision,
    effectiveDecision,
    messages,
    ruleDescription,
    sessionId,
    toolCallId,
  } = args
  const decidedPart = messages
    .flatMap((m) => m.parts)
    .find((p): p is ToolPart => p.type === 'tool' && p.toolCallId === toolCallId)

  track('agent_authorization_decided', {
    decision,
    effective_decision: effectiveDecision,
    approved,
    tool_name: decidedPart?.toolName,
    is_client_tool: decidedPart ? CLIENT_SIDE_LOCAL_TOOLS.has(decidedPart.toolName) : undefined,
    // The rule text is user/model-authored and can name infrastructure, so only
    // its presence ships.
    has_rule_description: Boolean(ruleDescription?.trim()),
    session_id: sessionId,
  })
}
