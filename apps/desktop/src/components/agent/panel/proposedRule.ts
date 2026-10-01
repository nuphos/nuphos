import type { ToolPart } from './parts'

// A `propose_authorization_rule` result carries a proposed (not-yet-active)
// standing rule. Surface it so the user can confirm/dismiss it inline, instead
// of having to hunt for it in Settings → Auto-authorization.
export function proposedRuleFrom(part: ToolPart): { ruleId: string; description: string } | null {
  if (part.toolName !== 'propose_authorization_rule') return null
  const out = part.output as { status?: unknown; ruleId?: unknown } | undefined

  if (out?.status !== 'proposed' || typeof out.ruleId !== 'string') return null
  const input = part.input as { description?: unknown } | undefined
  const description =
    typeof input?.description === 'string' && input.description.trim()
      ? input.description.trim()
      : 'this class of operations'

  return { ruleId: out.ruleId, description }
}
