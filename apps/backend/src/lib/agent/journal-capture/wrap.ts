import { randomUUID } from 'node:crypto'

import { AgentJournal } from './journal'

/**
 * Journal a plan approve/reject from ANY surface (in-app or Slack) onto the
 * plan's conversation chain. Fail-open; no-op for a plan not tied to a
 * conversation. Centralized so every approval path stamps the same trust root —
 * a missing surface is exactly the gap this closes.
 */
export async function journalPlanDecision(
  plan: {
    number: number
    sourceConversationId?: string
    approvedAt?: string
    rejectedAt?: string
  },
  actor: { userId: string; teamId: string | null },
  decision: 'approved' | 'rejected',
): Promise<void> {
  if (!plan.sourceConversationId) return
  const journal = new AgentJournal({
    userId: actor.userId,
    teamId: actor.teamId,
    conversationId: plan.sourceConversationId,
    requestId: `plan-${String(plan.number)}`,
    streamId: 'plan-decision',
    modelId: '',
  })

  await journal.planDecision({
    planNumber: plan.number,
    decision,
    decidedAt: (decision === 'approved' ? plan.approvedAt : plan.rejectedAt) ?? '',
  })
}

/**
 * Interpose the journal on every server-executed tool. Client-side tools
 * (no execute) pass through untouched — their results are captured from the
 * next request's transcript instead. This wraps OUTSIDE withLabel, so
 * short-circuited calls (e.g. the empty-bash guard) are journaled too.
 * Tool values are handled untyped for the same reason withLabel returns
 * `as any`: the record mixes zod v3/v4-typed AI SDK tools.
 */
export function wrapToolsWithJournal<T extends Record<string, unknown>>(
  tools: T,
  journal: AgentJournal,
): T {
  const wrapped: Record<string, unknown> = {}

  for (const [name, value] of Object.entries(tools)) {
    const original = value as {
      execute?: (input: unknown, opts: unknown) => Promise<unknown>
    } | null
    const execute = original?.execute

    if (!original || typeof execute !== 'function') {
      wrapped[name] = value
      continue
    }
    wrapped[name] = {
      ...original,
      execute: async (input: unknown, opts: unknown) => {
        const toolCallId =
          typeof (opts as { toolCallId?: unknown })?.toolCallId === 'string'
            ? (opts as { toolCallId: string }).toolCallId
            : randomUUID()

        await journal.toolIntent({ toolName: name, toolCallId, input })
        const startedAt = Date.now()

        try {
          const output = await execute.call(original, input, opts)

          await journal.toolResult({
            toolName: name,
            toolCallId,
            success: true,
            output,
            durationMs: Date.now() - startedAt,
          })

          return output
        } catch (err) {
          await journal.toolResult({
            toolName: name,
            toolCallId,
            success: false,
            output: err instanceof Error ? err.message : String(err),
            durationMs: Date.now() - startedAt,
          })
          throw err
        }
      },
    }
  }

  return wrapped as T
}
