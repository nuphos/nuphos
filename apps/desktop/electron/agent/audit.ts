import { callJson, teamQuery } from './http'

// Tamper-evident audit journal. Shapes mirror the backend's
// /agent-journal response; payload stays loosely typed because event payloads
// vary by event type and the timeline renders them defensively.
export type AgentJournalEvent = {
  kind?: 'agent'
  v: 1
  eventId: string
  seq: number
  ts: string
  type: string
  actor: { userId: string; teamId: string | null }
  session: {
    conversationId: string
    requestId: string | null
    streamId: string | null
    toolCallId: string | null
    modelId: string | null
  }
  payload: Record<string, unknown>
  payloadHash: string
  prevHash: string
  entryHash: string
  /** Hash-exempt display copy; verified server-side against payload.contentHash. */
  contentHot?: unknown
  contentVerified?: boolean | null
}

export type SkillAuditEvent = {
  kind: 'skill'
  eventId: string
  ts: string
  type: 'skill_mutation'
  actor: { userId: string | null; teamId: string | null }
  resource: { kind: 'skill'; scope: string; name: string }
  mutation: {
    mutationId: string
    action: 'create' | 'update' | 'delete_object' | 'delete_skill'
    status: 'applied' | 'failed' | 'partial'
    source: 'desktop' | 'admin' | 'agent' | 'import' | 'legacy'
    revision: number | null
    changedKeys: string[]
    error: string | null
    requestId: string | null
    conversationId: string | null
    toolCallId: string | null
  }
}

export type AgentAuditEvent = AgentJournalEvent | SkillAuditEvent

export type AgentJournalIntegrity = {
  chainOk: boolean
  violationCount: number
  violations: { seq: number; code: string; message: string }[]
  eventCount: number
  verifiedThroughSeq: number
  truncated: boolean
  headHash: string | null
  sealedThrough: number
  contentDivergenceCount: number
  level: 'violated' | 'live' | 'sealed' | 'anchored'
  lastAnchorAt: string | null
}

export type AgentJournalResponse = {
  sessionId: string
  events: AgentJournalEvent[]
  integrity: AgentJournalIntegrity
}

export async function getJournal(
  sessionId: string,
  teamId?: string,
): Promise<AgentJournalResponse> {
  return callJson<AgentJournalResponse>(
    'GET',
    `/agent-journal/${encodeURIComponent(sessionId)}${teamQuery(teamId)}`,
  )
}

// Cross-conversation audit listing.
export type AgentAuditListArgs = {
  scope?: 'mine' | 'team'
  teamId?: string
  userId?: string
  sessionId?: string
  sessionIds?: string[]
  mutationsOnly?: boolean
  from?: string
  to?: string
  cursor?: string
}

export type AgentAuditUser = { name: string; username: string; avatarURL: string }

export type AgentAuditConversationRow = {
  sessionId: string
  title: string
  ownerUserId: string | null
  lastTs: string
  firstTs: string
  eventCount: number
  mutationCount: number
  userIds: string[]
  /** Cheap seal-state approximation — full verification runs per conversation. */
  integrityLevel: 'live' | 'sealed' | 'anchored'
}

export type AgentAuditConversationsPage = {
  conversations: AgentAuditConversationRow[]
  users: Record<string, AgentAuditUser>
  nextCursor: string | null
}

export type AgentAuditEventsPage = {
  events: AgentAuditEvent[]
  conversations: Record<string, { title: string; ownerUserId?: string | null }>
  users: Record<string, AgentAuditUser>
  nextCursor: string | null
}

export type AgentComplianceIntegrity = {
  chainOk: boolean
  contentDivergenceCount: number
  eventCount: number
  verifiedThroughSeq: number
  headHash: string | null
  sealedThrough: number
  lastAnchorAt: string | null
  level: 'violated' | 'live' | 'sealed' | 'anchored'
  violations: { seq: number; code: string; message: string }[]
}

export type AgentComplianceExportBundle = {
  schemaVersion: 1
  generatedAt: string
  generatedByUserId: string
  scope: 'mine' | 'team'
  teamId: string | null
  filters: { from: string | null; to: string | null; mutationsOnly: boolean }
  selection: {
    semantics: 'matching-sessions-complete-chains' | 'explicit-sessions-complete-chains'
    sessionCount: number
    agentEventCount: number
    resourceEventCount: number
  }
  sessions: {
    sessionId: string
    title: string
    ownerUserId: string | null
    actors: string[]
    firstEventAt: string | null
    lastEventAt: string | null
    integrity: AgentComplianceIntegrity
    events: AgentJournalEvent[]
  }[]
  resourceEvents: SkillAuditEvent[]
  users: Record<string, AgentAuditUser>
}

function auditQuery(view: 'conversations' | 'events', args: AgentAuditListArgs): string {
  const params = new URLSearchParams({ view })

  if (args.scope) params.set('scope', args.scope)
  if (args.teamId) params.set('teamId', args.teamId)
  if (args.userId) params.set('userId', args.userId)
  if (args.sessionId) params.set('sessionId', args.sessionId)
  if (args.sessionIds?.length) params.set('sessionIds', args.sessionIds.join(','))
  if (args.mutationsOnly) params.set('mutationsOnly', 'true')
  if (args.from) params.set('from', args.from)
  if (args.to) params.set('to', args.to)
  if (args.cursor) params.set('cursor', args.cursor)

  return `/agent-journal?${params.toString()}`
}

export async function listJournalConversations(
  args: AgentAuditListArgs,
): Promise<AgentAuditConversationsPage> {
  return callJson<AgentAuditConversationsPage>('GET', auditQuery('conversations', args))
}

export async function listJournalEvents(args: AgentAuditListArgs): Promise<AgentAuditEventsPage> {
  return callJson<AgentAuditEventsPage>('GET', auditQuery('events', args))
}

export async function getComplianceExport(
  args: AgentAuditListArgs,
): Promise<AgentComplianceExportBundle> {
  const query = auditQuery('events', args).replace('/agent-journal?', '/agent-journal/export?')

  return callJson<AgentComplianceExportBundle>('GET', query)
}
