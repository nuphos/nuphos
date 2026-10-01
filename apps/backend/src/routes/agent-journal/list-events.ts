import { agentConversations } from '@/lib/agent/db'
import { fetchCachedUsers } from '@/lib/agent/directory'
import {
  AUDIT_CURSOR_KIND,
  auditCursorClause,
  parseAuditEventCursor,
  skillAuditEvent,
} from '@/lib/agent/skill-audit-events'
import { skillEvents } from '@/lib/agent/skill-store/metadata'
import {
  runtimeImageAuditEvent,
  runtimeImageEvents,
} from '@/lib/claude-code-preview/runtime-image-audit'
import { db } from '@/lib/db'
import { JOURNAL_COLLECTION } from '@/lib/journal'
import { LIST_MAX_EVENTS, contentMatches } from '@/routes/agent-journal/shared'

import type { JournalDoc } from '@/lib/journal'
import type { AuthVariables } from '@/middleware/auth'
import type { Context } from 'hono'

const AUDIT_RANK = { agent: 2, skill: 1, runtime: 0 } as const

type EventsViewParams = {
  base: Record<string, unknown>
  scope: 'mine' | 'team'
  teamId: string | undefined
  userId: string
  filterUserId: string | undefined
  sessionId: string | undefined
  from: string | undefined
  to: string | undefined
  types: string[] | undefined
}

export async function listAuditEventsView(
  c: Context<{ Variables: AuthVariables }>,
  { base, scope, teamId, userId, filterUserId, sessionId, from, to, types }: EventsViewParams,
) {
  const journal = db().collection<JournalDoc>(JOURNAL_COLLECTION)
  const cursorRaw = c.req.query('cursor')
  const cursor = cursorRaw ? parseAuditEventCursor(cursorRaw) : null
  const journalClauses: Record<string, unknown>[] = [base]

  if (cursor) journalClauses.push(auditCursorClause('ts', 'agent', cursor))

  const skillBase: Record<string, unknown> = { phase: 'result' }

  if (scope === 'team') {
    skillBase.teamId = teamId
  } else {
    skillBase.actorUserId = userId
    if (teamId) skillBase.teamId = teamId
  }
  if (filterUserId) skillBase.actorUserId = filterUserId
  if (sessionId) skillBase.conversationId = sessionId
  if (from || to) {
    skillBase.createdAt = {
      ...(from ? { $gte: new Date(from) } : {}),
      ...(to ? { $lte: new Date(to) } : {}),
    }
  }
  const includeSkillEvents =
    !types ||
    types.length === 0 ||
    types.includes('skill_mutation') ||
    c.req.query('mutationsOnly') === 'true'
  const skillClauses: Record<string, unknown>[] = [skillBase]

  if (cursor) skillClauses.push(auditCursorClause('createdAt', 'skill', cursor))

  // A runtime image change belongs to its team, not to any conversation, so a
  // conversation-scoped listing leaves it out.
  const runtimeBase: Record<string, unknown> = {}

  if (teamId) runtimeBase.teamId = teamId
  if (scope !== 'team') runtimeBase.actorUserId = userId
  if (filterUserId) runtimeBase.actorUserId = filterUserId
  if (from || to) {
    runtimeBase.createdAt = {
      ...(from ? { $gte: new Date(from) } : {}),
      ...(to ? { $lte: new Date(to) } : {}),
    }
  }
  const includeRuntimeEvents =
    !sessionId &&
    c.req.query('mutationsOnly') !== 'true' &&
    (!types || types.length === 0 || types.includes('runtime_image_change'))
  const runtimeClauses: Record<string, unknown>[] = [runtimeBase]

  if (cursor) runtimeClauses.push(auditCursorClause('createdAt', 'runtime', cursor))

  const [journalDocs, skillDocs, runtimeDocs] = await Promise.all([
    journal
      .find(journalClauses.length > 1 ? { $and: journalClauses } : base)
      .sort({ ts: -1, _id: -1 })
      .limit(LIST_MAX_EVENTS + 1)
      .toArray(),
    includeSkillEvents
      ? skillEvents()
          .find(skillClauses.length > 1 ? { $and: skillClauses } : skillBase)
          .sort({ createdAt: -1, _id: -1 })
          .limit(LIST_MAX_EVENTS + 1)
          .toArray()
      : Promise.resolve([]),
    includeRuntimeEvents
      ? runtimeImageEvents()
          .find(runtimeClauses.length > 1 ? { $and: runtimeClauses } : runtimeBase)
          .sort({ createdAt: -1, _id: -1 })
          .limit(LIST_MAX_EVENTS + 1)
          .toArray()
      : Promise.resolve([]),
  ])

  const ordered = [
    ...journalDocs.map((doc) => ({
      kind: 'agent' as const,
      ts: doc.ts,
      id: doc._id!,
      doc,
    })),
    ...skillDocs.map((doc) => ({
      kind: 'skill' as const,
      ts: doc.createdAt.toISOString(),
      id: doc._id!,
      doc,
    })),
    ...runtimeDocs.map((doc) => ({
      kind: 'runtime' as const,
      ts: doc.createdAt.toISOString(),
      id: doc._id!,
      doc,
    })),
  ].sort((a, b) => {
    const byTime = b.ts.localeCompare(a.ts)

    if (byTime !== 0) return byTime
    const byKind = AUDIT_RANK[b.kind] - AUDIT_RANK[a.kind]

    if (byKind !== 0) return byKind

    return b.id.toHexString().localeCompare(a.id.toHexString())
  })
  const hasMore = ordered.length > LIST_MAX_EVENTS
  const page = ordered.slice(0, LIST_MAX_EVENTS)
  const journalPage = page
    .filter(
      (entry): entry is Extract<(typeof page)[number], { kind: 'agent' }> => entry.kind === 'agent',
    )
    .map((entry) => entry.doc)
  const events = page.map((entry) => {
    if (entry.kind === 'skill') return skillAuditEvent(entry.doc)
    if (entry.kind === 'runtime') return runtimeImageAuditEvent(entry.doc)
    const { _id, contentHot, ...event } = entry.doc as JournalDoc & { _id?: unknown }

    // sessionId stays in agent events so those rows can open their real
    // conversation. Resource events deliberately have no fake session.
    return contentHot !== undefined
      ? {
          kind: 'agent' as const,
          ...event,
          contentHot,
          contentVerified: contentMatches(contentHot, event.payload),
        }
      : { kind: 'agent' as const, ...event }
  })
  const last = page.at(-1)
  const actorUserIds = page
    .map((entry) => (entry.kind === 'agent' ? entry.doc.actor.userId : entry.doc.actorUserId))
    .filter((id): id is string => Boolean(id))
  const [convDocs, users] = await Promise.all([
    agentConversations()
      .find(
        { sessionId: { $in: [...new Set(journalPage.map((doc) => doc.sessionId))] } },
        { projection: { sessionId: 1, title: 1, userId: 1 } },
      )
      .toArray(),
    fetchCachedUsers([...new Set(actorUserIds)]),
  ])

  return c.json({
    view: 'events' as const,
    events,
    conversations: Object.fromEntries(
      convDocs.map((conv) => [
        conv.sessionId,
        { title: conv.title || 'Untitled chat', ownerUserId: conv.userId },
      ]),
    ),
    users,
    nextCursor:
      hasMore && last
        ? `${last.ts}~${AUDIT_CURSOR_KIND[last.kind]}~${last.id.toHexString()}`
        : null,
  })
}
