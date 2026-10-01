import type { JournalWriter, JournalDoc } from '@/lib/journal'
import type { Collection } from 'mongodb'

export type AgentJournalInit = {
  userId: string
  teamId: string | null
  conversationId: string
  requestId: string
  streamId: string
  modelId: string
  /** Test seam; production resolves the shared Mongo collection lazily. */
  writer?: JournalWriter
  collection?: Collection<JournalDoc>
  /** Test seam; production resolves the conversation's active plan lazily. */
  resolveActivePlan?: (
    sessionId: string,
    scope: { teamId: string | null; userId: string },
  ) => Promise<{ planNumber: number; approvedBy?: string } | null>
}

/**
 * Who authorized a tool execution — part of the hashed payload.
 *
 * `basis` states HOW the attribution was derived, so downstream consumers
 * never over-read v1 data: 'active-plan' means "an approved/executing plan
 * was active for this conversation when the call was journaled" — an
 * inference, NOT per-command plan binding. When plan execution context is
 * threaded through the turn (phase 2), those events will carry
 * basis: 'execution-context' and strong filters can require it.
 */
export type ToolAuthorization =
  | { kind: 'plan-approved'; basis: 'active-plan'; planNumber: number; approvedBy?: string }
  | { kind: 'user-approved'; basis: 'approval-gate' }
  | { kind: 'agent-initiated'; basis: 'no-active-plan' }
