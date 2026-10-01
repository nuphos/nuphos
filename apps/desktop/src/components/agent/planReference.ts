export type PlanReferenceToolPart = {
  type: 'tool'
  toolCallId: string
  toolName: string
  output?: unknown
}

export type PlanReferenceMessage = {
  role: string
  parts: ({ type: string } | PlanReferenceToolPart)[]
}

export type ConversationPlanReference = {
  id: string
  sourceConversationId?: string
  createdAt: string
}

const PLAN_PROPOSAL_TOOL_NAMES = new Set(['plan_create', 'database_change_propose'])

export function isPlanProposalToolName(toolName: string): boolean {
  return PLAN_PROPOSAL_TOOL_NAMES.has(toolName)
}

/**
 * Plan-producing tools do not all use the same response envelope:
 * `plan_create` returns `{ planId }`, while typed resource proposal tools
 * return `{ ok, plan: { id } }`. Normalize both so every persisted Plan gets
 * the same conversation card and side-panel behavior.
 */
export function extractPersistedPlanId(output: unknown): string | null {
  if (!output || typeof output !== 'object') return null
  const value = output as Record<string, unknown>

  if (typeof value.planId === 'string' && value.planId.length > 0) return value.planId
  if (typeof value.id === 'string' && value.id.length > 0) return value.id

  const nestedPlan = value.plan

  if (!nestedPlan || typeof nestedPlan !== 'object') return null
  const plan = nestedPlan as Record<string, unknown>

  if (typeof plan.planId === 'string' && plan.planId.length > 0) return plan.planId
  if (typeof plan.id === 'string' && plan.id.length > 0) return plan.id

  return null
}

export function findLatestPlanReference(
  messages: PlanReferenceMessage[],
): { toolCallId: string; planId: string } | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const message = messages[messageIndex]

    if (message.role !== 'assistant') continue
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex--) {
      const part = message.parts[partIndex]

      if (part.type !== 'tool' || !('toolName' in part) || !isPlanProposalToolName(part.toolName)) {
        continue
      }
      const planId = extractPersistedPlanId(part.output)

      if (planId) return { toolCallId: part.toolCallId, planId }
    }
  }

  return null
}

/**
 * Native runtime skills can create a Plan through the conversation-scoped
 * REST surface. The live tool frame is best-effort, while the Plan document is
 * durable; use the latter as a fallback so a dropped frame cannot leave the
 * card invisible.
 */
export function findLatestConversationPlanId(
  plans: ConversationPlanReference[],
  sessionId: string,
): string | null {
  let latest: ConversationPlanReference | null = null

  for (const plan of plans) {
    if (plan.sourceConversationId !== sessionId) continue
    if (!latest || plan.createdAt > latest.createdAt) latest = plan
  }

  return latest?.id ?? null
}
