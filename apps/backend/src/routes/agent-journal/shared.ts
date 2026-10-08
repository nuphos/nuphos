import { agentConversations } from '@/lib/agent/db'
import { conversationAccess } from '@/lib/agent/db/access'
import { AppError } from '@/lib/errors'
import { canonicalize, sha256Hex } from '@/lib/journal'
import { normalizeComplianceTimestamp } from '@/lib/journal/compliance-export'

import type { AgentConversation } from '@/lib/agent/db'

export const MAX_EVENTS = 5000
export const LIST_MAX_EVENTS = 100
export const LIST_MAX_CONVERSATIONS = 50
export const EXPORT_MAX_SESSIONS = 250
export const EXPORT_MAX_AGENT_EVENTS = 100_000
export const EXPORT_MAX_RESOURCE_EVENTS = 10_000

// contentHot is the hash-exempt display copy; the server recomputes its hash
// against payload.contentHash on every read so every surface that shows it can
// mark items verified/divergent without client-side crypto.
function stableSerialize(value: unknown, alg: 'jcs' | 'json'): string {
  if (alg === 'jcs') {
    try {
      return canonicalize(value)
    } catch {
      /* fall through */
    }
  }

  return JSON.stringify(value) ?? String(value)
}

export function normalizeRangeTimestamp(label: string, value: string | undefined): string | null {
  try {
    return normalizeComplianceTimestamp(value ?? null)
  } catch {
    throw new AppError(400, 'invalid_request', `${label} must be an ISO-8601 timestamp`)
  }
}

export function contentMatches(contentHot: unknown, payload: unknown): boolean | null {
  const p = payload as { contentHash?: string; hashAlg?: 'jcs' | 'json' } | null

  if (!p || typeof p !== 'object' || typeof p.contentHash !== 'string') return null

  return sha256Hex(stableSerialize(contentHot, p.hashAlg ?? 'jcs')) === p.contentHash
}

// The audit trail of what agents did stays team-wide; what a private session
// was about does not, so its title is withheld from anyone it was not shared with.
export const JOURNAL_CONVERSATION_PROJECTION = {
  sessionId: 1,
  title: 1,
  userId: 1,
  teamId: 1,
  generalAccess: 1,
  participantIds: 1,
  viewOnlyIds: 1,
} as const

export function journalConversationTitle(conversation: AgentConversation, viewerId: string) {
  return conversationAccess(conversation, viewerId)
    ? conversation.title || 'Untitled chat'
    : 'Private session'
}

/**
 * The sessions among `sessionIds` this viewer may not open. Their events stay
 * in the team audit as facts (who ran which tool, when) but lose their content.
 * A session with no conversation doc left has nobody to protect, so it stays.
 */
export async function unreadableSessionIds(sessionIds: string[], viewerId: string) {
  if (sessionIds.length === 0) return new Set<string>()
  const docs = await agentConversations()
    .find({ sessionId: { $in: sessionIds } }, { projection: JOURNAL_CONVERSATION_PROJECTION })
    .toArray()

  return new Set(
    docs.filter((doc) => !conversationAccess(doc, viewerId)).map((doc) => doc.sessionId),
  )
}

/** An explicitly requested session answers like the transcript route: not found. */
export async function assertJournalSessionsReadable(sessionIds: string[], viewerId: string) {
  if ((await unreadableSessionIds(sessionIds, viewerId)).size > 0)
    throw new AppError(404, 'not_found', 'Conversation not found')
}
