import { agentConversations } from '@/lib/agent/db'
import { fetchCachedUsers } from '@/lib/agent/directory'
import { MUTATING_TOOL_NAMES } from '@/lib/agent/journal-capture'
import { skillAuditEvent } from '@/lib/agent/skill-audit-events'
import { skillEvents } from '@/lib/agent/skill-store/metadata'
import { db } from '@/lib/db'
import { AppError } from '@/lib/errors'
import { JOURNAL_COLLECTION } from '@/lib/journal'
import {
  COMPLIANCE_EXPORT_SCHEMA_VERSION,
  buildComplianceSession,
} from '@/lib/journal/compliance-export'
import { SEAL_STATE_COLLECTION } from '@/lib/journal/sealer'
import { resolveVerifiedTeamId } from '@/routes/agent'
import {
  EXPORT_MAX_AGENT_EVENTS,
  EXPORT_MAX_RESOURCE_EVENTS,
  EXPORT_MAX_SESSIONS,
  contentMatches,
  normalizeRangeTimestamp,
} from '@/routes/agent-journal/shared'

import type { JournalDoc } from '@/lib/journal'
import type { ComplianceExportBundle } from '@/lib/journal/compliance-export'
import type { SealStateDoc } from '@/lib/journal/sealer'
import type { AuthVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

/**
 * Complete compliance evidence export.
 *
 * The date/mutation filters SELECT sessions, but every selected session is
 * exported from genesis through its true tail. Filtering individual events
 * would break the evidence chain and could make an incomplete export look
 * valid. Limits fail explicitly; this endpoint never silently truncates.
 */
export function registerAgentJournalExportRoute(agentJournal: Hono<{ Variables: AuthVariables }>) {
  agentJournal.get('/export', async (c) => {
    const userId = c.get('userId')
    const scope = c.req.query('scope') === 'team' ? 'team' : 'mine'
    const teamId = await resolveVerifiedTeamId(c, c.req.query('teamId'))

    if (scope === 'team' && !teamId) {
      throw new AppError(400, 'invalid_request', 'scope=team requires a valid teamId')
    }

    const selected: Record<string, unknown> =
      scope === 'team'
        ? { 'actor.teamId': teamId }
        : { 'actor.userId': userId, ...(teamId ? { 'actor.teamId': teamId } : {}) }
    const filterUserId = c.req.query('userId')

    if (filterUserId) {
      if (scope !== 'team' && filterUserId !== userId) {
        throw new AppError(403, 'forbidden', 'userId filter requires scope=team')
      }
      selected['actor.userId'] = filterUserId
    }
    const requestedSessionId = c.req.query('sessionId')
    const requestedSessionIds = (c.req.query('sessionIds') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)

    if (requestedSessionId && requestedSessionIds.length > 0) {
      throw new AppError(400, 'invalid_request', 'Use either sessionId or sessionIds, not both')
    }
    if (requestedSessionIds.length > EXPORT_MAX_SESSIONS) {
      throw new AppError(
        413,
        'compliance_export_too_large',
        `Select at most ${String(EXPORT_MAX_SESSIONS)} sessions per export`,
      )
    }
    const explicitSessionIds = requestedSessionId
      ? [requestedSessionId]
      : [...new Set(requestedSessionIds)]

    if (explicitSessionIds.length > 0) {
      selected.sessionId = { $in: explicitSessionIds }
    }

    const from = normalizeRangeTimestamp('from', c.req.query('from'))
    const to = normalizeRangeTimestamp('to', c.req.query('to'))

    if (from && to && from > to) {
      throw new AppError(400, 'invalid_request', 'from must be before to')
    }
    if (explicitSessionIds.length === 0 && (from || to)) {
      selected.ts = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) }
    }
    const mutationsOnly = c.req.query('mutationsOnly') === 'true'

    if (explicitSessionIds.length === 0 && mutationsOnly) {
      selected.type = 'tool_call_intent'
      selected['payload.toolName'] = { $in: [...MUTATING_TOOL_NAMES] }
    }

    const journal = db().collection<JournalDoc>(JOURNAL_COLLECTION)
    const selectedRows = await journal
      .aggregate<{ _id: string }>([
        { $match: selected },
        { $group: { _id: '$sessionId' } },
        { $sort: { _id: 1 } },
        { $limit: EXPORT_MAX_SESSIONS + 1 },
      ])
      .toArray()

    if (selectedRows.length > EXPORT_MAX_SESSIONS) {
      throw new AppError(
        413,
        'compliance_export_too_large',
        `Export matches more than ${String(EXPORT_MAX_SESSIONS)} sessions; choose a shorter date range`,
      )
    }
    const sessionIds = selectedRows.map((row) => row._id)
    // Freeze each selected chain at its true tail before reading documents.
    // New events appended while the export runs belong to the next export;
    // this one remains complete and verifiable as of these snapshot heads.
    const snapshotTails = sessionIds.length
      ? await journal
          .aggregate<{ _id: string; maxSeq: number }>([
            { $match: { sessionId: { $in: sessionIds } } },
            { $group: { _id: '$sessionId', maxSeq: { $max: '$seq' } } },
          ])
          .toArray()
      : []
    const snapshotFilter = snapshotTails.length
      ? {
          $or: snapshotTails.map((tail) => ({
            sessionId: tail._id,
            seq: { $lte: tail.maxSeq },
          })),
        }
      : null
    const resourceFilter: Record<string, unknown> = { phase: 'result' }

    if (scope === 'team') {
      resourceFilter.teamId = teamId
    } else {
      resourceFilter.actorUserId = userId
      if (teamId) resourceFilter.teamId = teamId
    }
    if (filterUserId) resourceFilter.actorUserId = filterUserId
    if (explicitSessionIds.length > 0) {
      resourceFilter.conversationId = { $in: explicitSessionIds }
    }
    if (explicitSessionIds.length === 0 && (from || to)) {
      resourceFilter.createdAt = {
        ...(from ? { $gte: new Date(from) } : {}),
        ...(to ? { $lte: new Date(to) } : {}),
      }
    }

    const [docs, resourceDocs, stateDocs, globalState, convDocs] = await Promise.all([
      snapshotFilter
        ? journal
            .find(snapshotFilter)
            .sort({ sessionId: 1, seq: 1 })
            // One capped read both materializes the export and proves whether
            // it exceeds the limit. A separate countDocuments pass made large
            // team exports scan every selected chain twice and could time out
            // before the actual evidence read even began.
            .limit(EXPORT_MAX_AGENT_EVENTS + 1)
            .toArray()
        : Promise.resolve([]),
      skillEvents()
        .find(resourceFilter)
        .sort({ createdAt: 1, _id: 1 })
        .limit(EXPORT_MAX_RESOURCE_EVENTS + 1)
        .toArray(),
      sessionIds.length
        ? db()
            .collection<SealStateDoc>(SEAL_STATE_COLLECTION)
            .find({ _id: { $in: sessionIds.map((sessionId) => `s:${sessionId}`) } })
            .toArray()
        : Promise.resolve([]),
      db().collection<SealStateDoc>(SEAL_STATE_COLLECTION).findOne({ _id: '__global__' }),
      sessionIds.length
        ? agentConversations()
            .find(
              { sessionId: { $in: sessionIds } },
              { projection: { sessionId: 1, title: 1, userId: 1 } },
            )
            .toArray()
        : Promise.resolve([]),
    ])

    // Never ship an over-limit package silently. The +1 sentinel above makes
    // this exact without a second full collection scan.
    if (docs.length > EXPORT_MAX_AGENT_EVENTS) {
      throw new AppError(
        413,
        'compliance_export_too_large',
        `Export contains more than ${String(EXPORT_MAX_AGENT_EVENTS)} agent events; choose a shorter date range`,
      )
    }
    if (resourceDocs.length > EXPORT_MAX_RESOURCE_EVENTS) {
      throw new AppError(
        413,
        'compliance_export_too_large',
        `Export contains more than ${String(EXPORT_MAX_RESOURCE_EVENTS)} resource events; choose a shorter date range`,
      )
    }

    const docsBySession = new Map<string, JournalDoc[]>()

    for (const doc of docs) {
      const list = docsBySession.get(doc.sessionId) ?? []

      list.push(doc)
      docsBySession.set(doc.sessionId, list)
    }
    const stateBySession = new Map(stateDocs.map((state) => [state._id.slice(2), state]))
    const metadataBySession = new Map(
      convDocs.map((conv) => [
        conv.sessionId,
        { title: conv.title || 'Untitled chat', ownerUserId: conv.userId ?? null },
      ]),
    )
    const sessions = sessionIds.map((sessionId) => {
      const sessionDocs = docsBySession.get(sessionId) ?? []
      const contentDivergenceCount = sessionDocs.reduce(
        (count, doc) =>
          count +
          Number(
            doc.contentHot !== undefined && contentMatches(doc.contentHot, doc.payload) === false,
          ),
        0,
      )
      const meta = metadataBySession.get(sessionId)

      return buildComplianceSession({
        sessionId,
        title: meta?.title ?? 'Untitled chat',
        ownerUserId: meta?.ownerUserId ?? null,
        docs: sessionDocs,
        contentDivergenceCount,
        sealedThrough: stateBySession.get(sessionId)?.sealedThrough ?? 0,
        lastAnchorAt: globalState?.lastAnchorAt ?? null,
      })
    })
    const resourceEvents = resourceDocs.map(skillAuditEvent)
    const actorUserIds = [
      userId,
      ...sessions.flatMap((session) => session.actors),
      ...sessions.map((session) => session.ownerUserId).filter((id): id is string => Boolean(id)),
      ...resourceEvents
        .map((event) => event.actor.userId)
        .filter((id): id is string => Boolean(id)),
    ]
    const users = await fetchCachedUsers(actorUserIds)

    const bundle: ComplianceExportBundle = {
      schemaVersion: COMPLIANCE_EXPORT_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      generatedByUserId: userId,
      scope,
      teamId: teamId ?? null,
      filters: { from, to, mutationsOnly },
      selection: {
        semantics:
          explicitSessionIds.length > 0
            ? 'explicit-sessions-complete-chains'
            : 'matching-sessions-complete-chains',
        sessionCount: sessions.length,
        agentEventCount: docs.length,
        resourceEventCount: resourceEvents.length,
      },
      sessions,
      resourceEvents,
      users,
    }

    return c.json(bundle)
  })
}
