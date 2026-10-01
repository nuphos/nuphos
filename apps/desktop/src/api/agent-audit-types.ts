import type { TeamSkillMutationSource } from './plan-types.ts'

// Tamper-evident audit journal: mirrors backend /agent-journal.
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
    source: TeamSkillMutationSource
    revision: number | null
    changedKeys: string[]
    error: string | null
    requestId: string | null
    conversationId: string | null
    toolCallId: string | null
  }
}

/** A team administrator repointed a managed runtime at another container image.
 *  The runtime keeps its bound credentials across the swap. */
export type RuntimeImageAuditEvent = {
  kind: 'runtime_image'
  eventId: string
  ts: string
  type: 'runtime_image_change'
  actor: { userId: string | null; teamId: string | null }
  resource: {
    kind: 'runtime'
    runtimeId: string
    provider: 'claude-code' | 'codex'
    label: string
  }
  change: { fromImage: string | null; toImage: string }
}

export type AgentAuditEvent = AgentJournalEvent | SkillAuditEvent | RuntimeImageAuditEvent

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

// Cross-conversation audit listing: mirrors electron/agent.ts.
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

export type AgentComplianceExportResult =
  | { saved: false }
  | {
      saved: true
      path: string
      sessionCount: number
      eventCount: number
      fileCount: number
    }

export type AgentMemoryItem = {
  id: string
  type: 'fact' | 'artifact' | 'episode'
  title?: string
  text: string
  categories: string[]
  createdAt: string
  updatedAt: string
  convId: string | null
  userId: string | null
  appId: string | null
  groupIds: string[]
  // Present only on state=removed listings (ADR-0005 restore flow).
  disabledAt?: string
  disabledBy?: string
  disabledReason?: string
  // Present only on team Genes (ADR-0007 #4): structured strategy sections.
  gene?: {
    title: string
    triggerSignals: string[]
    investigationPath: { action: string; check: string; nextWhen?: string }[]
    traps: string[]
    doNotUseWhen: string[]
    status: string
    revision?: number
    // Detail (get-by-id) responses only: the append-only evidence behind the
    // strategy (ADR-0007 item 6). Read-only — no per-capsule mutation exists.
    capsules?: {
      outcome: string
      problem: string
      rootCause?: string
      actions: string[]
      verification: string[]
      conversationId: string
      planId?: string
      observedAt: string
    }[]
  }
}

export type AgentMemoryScope = 'personal' | 'team'

export type AutoModeRule = {
  id: string
  description: string
  status: 'proposed' | 'active'
  createdAt: string
  createdBy: string
  proposedFromConversationId?: string
}

export type AgentMemoryIngestEventItem = {
  id: string
  type: 'fact' | 'artifact' | 'episode'
  title?: string
  text: string
  categories: string[]
  scopes: AgentMemoryScope[]
  createdAt: string
  updatedAt: string
}

export type AgentMemoryIngestEventPage = {
  enabled: boolean
  status?: 'pending' | 'ok'
  memories: AgentMemoryIngestEventItem[]
}

export type AgentMemoryPage = {
  enabled: boolean
  memories: AgentMemoryItem[]
  nextCursor: string | null
  hasMore: boolean
}

// Track A 2.3: pool health + per-memory retention (Memories view scorecard).
export type AgentMemoryScore = {
  turns: number
  applied: number
  applyRate: number
  corrections: number
  reachConversations: number
  reachUsers: number
  lastAppliedAt: string | null
  proven: boolean
}

export type AgentMemoryScorecard = {
  summary: {
    windowDays: number
    learnedLast7d: number
    turns: {
      total: number
      withRecall: number
      withApplied: number
      recallRate: number
      zeroRecallRate: number
      appliedRate: number
    }
    judge: {
      ran: number
      failed: number
      pending: number
      skippedDisabled: number
      skippedSampled: number
      skippedZeroCandidates: number
      ranRate: number
    }
    distill: Record<string, number>
  }
  scores: Record<string, AgentMemoryScore>
}
