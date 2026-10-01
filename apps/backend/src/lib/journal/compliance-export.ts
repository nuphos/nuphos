import { verifyConversationChain } from '@/lib/journal'

import type { AuditEvent, JournalDoc } from '@/lib/journal'

export const COMPLIANCE_EXPORT_SCHEMA_VERSION = 1 as const

export type ComplianceIntegrityLevel = 'violated' | 'live' | 'sealed' | 'anchored'

export type ComplianceSessionEvidence = {
  sessionId: string
  title: string
  ownerUserId: string | null
  actors: string[]
  firstEventAt: string | null
  lastEventAt: string | null
  integrity: {
    chainOk: boolean
    contentDivergenceCount: number
    eventCount: number
    verifiedThroughSeq: number
    headHash: string | null
    sealedThrough: number
    lastAnchorAt: string | null
    level: ComplianceIntegrityLevel
    violations: { seq: number; code: string; message: string }[]
  }
  /** Complete, redacted, hash-covered chain. contentHot is intentionally excluded. */
  events: AuditEvent[]
}

export type ComplianceExportBundle = {
  schemaVersion: typeof COMPLIANCE_EXPORT_SCHEMA_VERSION
  generatedAt: string
  generatedByUserId: string
  scope: 'mine' | 'team'
  teamId: string | null
  filters: {
    from: string | null
    to: string | null
    mutationsOnly: boolean
  }
  selection: {
    /** A session is selected when at least one event matches the filters. */
    semantics: 'matching-sessions-complete-chains' | 'explicit-sessions-complete-chains'
    sessionCount: number
    agentEventCount: number
    resourceEventCount: number
  }
  sessions: ComplianceSessionEvidence[]
  /** Supplementary direct resource mutations; these are not members of a session hash chain. */
  resourceEvents: unknown[]
  users: Record<string, { name: string; username: string; avatarURL: string }>
}

export function normalizeComplianceTimestamp(value: string | null): string | null {
  if (!value) return null
  const timestamp = Date.parse(value)

  if (Number.isNaN(timestamp)) throw new Error('invalid ISO-8601 timestamp')

  return new Date(timestamp).toISOString()
}

function eventFromDoc(doc: JournalDoc): AuditEvent {
  const {
    sessionId: _sessionId,
    _id,
    contentHot: _contentHot,
    ...event
  } = doc as JournalDoc & { _id?: unknown }

  return event as AuditEvent
}

export function buildComplianceSession(input: {
  sessionId: string
  title: string
  ownerUserId: string | null
  docs: JournalDoc[]
  /** Verified by the read route against payload.contentHash before export. */
  contentDivergenceCount: number
  sealedThrough: number
  lastAnchorAt: string | null
}): ComplianceSessionEvidence {
  const docs = [...input.docs].sort((a, b) => a.seq - b.seq)
  const events = docs.map(eventFromDoc)
  const verification = verifyConversationChain(events)
  const firstViolationSeq = Math.min(
    ...verification.violations.map((violation) => violation.seq),
    Number.POSITIVE_INFINITY,
  )
  let verifiedThroughSeq = 0

  for (const event of events) {
    if (event.seq >= firstViolationSeq || event.seq !== verifiedThroughSeq + 1) break
    verifiedThroughSeq = event.seq
  }
  const contentDivergenceCount = input.contentDivergenceCount
  const tail = events.at(-1)
  const sealed = !!tail && input.sealedThrough >= tail.seq
  // The export does not yet carry the segment manifest and external anchor
  // proof needed for an auditor to verify inclusion independently. Preserve
  // lastAnchorAt as metadata, but do not make an unprovable anchored claim in
  // the exported report.
  const level: ComplianceIntegrityLevel =
    !verification.ok || contentDivergenceCount > 0 ? 'violated' : sealed ? 'sealed' : 'live'

  return {
    sessionId: input.sessionId,
    title: input.title,
    ownerUserId: input.ownerUserId,
    actors: [...new Set(events.map((event) => event.actor.userId).filter(Boolean))],
    firstEventAt: events[0]?.ts ?? null,
    lastEventAt: tail?.ts ?? null,
    integrity: {
      chainOk: verification.ok,
      contentDivergenceCount,
      eventCount: events.length,
      verifiedThroughSeq,
      headHash: tail?.entryHash ?? null,
      sealedThrough: input.sealedThrough,
      lastAnchorAt: input.lastAnchorAt,
      level,
      violations: verification.violations,
    },
    events,
  }
}
