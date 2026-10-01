import { agentConversations } from '@/lib/agent/db'
import { fetchCachedUsers } from '@/lib/agent/directory'
import { MUTATING_TOOL_NAMES } from '@/lib/agent/journal-capture'
import { db } from '@/lib/db'
import { AppError } from '@/lib/errors'
import { JOURNAL_COLLECTION } from '@/lib/journal'
import { SEAL_STATE_COLLECTION } from '@/lib/journal/sealer'
import { resolveVerifiedTeamId } from '@/routes/agent'
import { listAuditEventsView } from '@/routes/agent-journal/list-events'
import { LIST_MAX_CONVERSATIONS } from '@/routes/agent-journal/shared'

import type { JournalDoc } from '@/lib/journal'
import type { SealStateDoc } from '@/lib/journal/sealer'
import type { AuthVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

/**
 * Cross-conversation audit listing.
 *
 * GET /agent-journal?scope=mine|team&teamId=...&view=conversations|events
 *   &userId=&sessionId=&types=a,b&mutationsOnly=true&from=&to=&cursor=
 *
 * Two views over the same filters:
 *   conversations — one row per conversation (counts, actors, time range,
 *     integrity level). The level here is the cheap seal-state approximation
 *     (live/sealed/anchored, never "violated") — full chain verification only
 *     runs when a conversation is opened (GET /:sessionId).
 *   events — flat newest-first stream, cursor-paginated.
 */
export function registerAgentJournalListRoute(agentJournal: Hono<{ Variables: AuthVariables }>) {
  agentJournal.get('/', async (c) => {
    const userId = c.get('userId')
    const scope = c.req.query('scope') === 'team' ? 'team' : 'mine'
    const teamId = await resolveVerifiedTeamId(c, c.req.query('teamId'))

    if (scope === 'team' && !teamId) {
      throw new AppError(400, 'invalid_request', 'scope=team requires a valid teamId')
    }

    // mine = the caller's own activity, additionally narrowed to the verified
    // team when one is given (the Audit page lives under /teams/:id/audit —
    // mixing personal/other-team activity into a team view would mislead).
    const base: Record<string, unknown> =
      scope === 'team'
        ? { 'actor.teamId': teamId }
        : { 'actor.userId': userId, ...(teamId ? { 'actor.teamId': teamId } : {}) }
    const filterUserId = c.req.query('userId')

    if (filterUserId) {
      // The userId filter is a TEAM-scope refinement. In mine scope it must
      // never widen visibility: any value other than the caller is a
      // cross-user read attempt (codex review P1).
      if (scope !== 'team' && filterUserId !== userId) {
        throw new AppError(403, 'forbidden', 'userId filter requires scope=team')
      }
      base['actor.userId'] = filterUserId
    }
    const sessionId = c.req.query('sessionId')

    if (sessionId) base.sessionId = sessionId
    const from = c.req.query('from')
    const to = c.req.query('to')

    if (from || to) {
      base.ts = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) }
    }
    const types = c.req
      .query('types')
      ?.split(',')
      .map((t) => t.trim())
      .filter(Boolean)

    if (c.req.query('mutationsOnly') === 'true') {
      // Mutations = the fail-closed tool set: the calls that changed something.
      base.type = 'tool_call_intent'
      base['payload.toolName'] = { $in: [...MUTATING_TOOL_NAMES] }
    } else if (types && types.length > 0) {
      base.type = { $in: types }
    }

    const journal = db().collection<JournalDoc>(JOURNAL_COLLECTION)
    const view = c.req.query('view') === 'events' ? 'events' : 'conversations'

    if (view === 'events') {
      return listAuditEventsView(c, {
        base,
        scope,
        teamId,
        userId,
        filterUserId,
        sessionId,
        from,
        to,
        types,
      })
    }

    // Compound cursor (lastTs~sessionId): plain lastTs would skip/repeat rows
    // whose conversations share an identical timestamp.
    const convCursorRaw = c.req.query('cursor')
    let convCursor: { lastTs: string; sessionId: string } | null = null

    if (convCursorRaw) {
      const tilde = convCursorRaw.lastIndexOf('~')
      const cTs = tilde > 0 ? convCursorRaw.slice(0, tilde) : ''
      const cSid = tilde > 0 ? convCursorRaw.slice(tilde + 1) : ''

      if (!cTs || !cSid) {
        throw new AppError(400, 'invalid_request', 'malformed cursor')
      }
      convCursor = { lastTs: cTs, sessionId: cSid }
    }
    const mutationCond = {
      $cond: [
        {
          $and: [
            { $eq: ['$type', 'tool_call_intent'] },
            { $in: ['$payload.toolName', [...MUTATING_TOOL_NAMES]] },
          ],
        },
        1,
        0,
      ],
    }
    const rows = await journal
      .aggregate<{
        _id: string
        lastTs: string
        firstTs: string
        eventCount: number
        mutationCount: number
        maxSeq: number
        userIds: string[]
      }>([
        { $match: base },
        {
          $group: {
            _id: '$sessionId',
            lastTs: { $max: '$ts' },
            firstTs: { $min: '$ts' },
            eventCount: { $sum: 1 },
            mutationCount: { $sum: mutationCond },
            maxSeq: { $max: '$seq' },
            userIds: { $addToSet: '$actor.userId' },
          },
        },
        ...(convCursor
          ? [
              {
                $match: {
                  $or: [
                    { lastTs: { $lt: convCursor.lastTs } },
                    { lastTs: convCursor.lastTs, _id: { $lt: convCursor.sessionId } },
                  ],
                },
              },
            ]
          : []),
        { $sort: { lastTs: -1, _id: -1 } },
        { $limit: LIST_MAX_CONVERSATIONS + 1 },
      ])
      .toArray()
    const hasMore = rows.length > LIST_MAX_CONVERSATIONS
    const page = rows.slice(0, LIST_MAX_CONVERSATIONS)

    const state = db().collection<SealStateDoc>(SEAL_STATE_COLLECTION)
    const [sessionStates, globalState, trueTails, convDocs, users] = await Promise.all([
      state.find({ _id: { $in: page.map((row) => `s:${row._id}`) } }).toArray(),
      state.findOne({ _id: '__global__' }),
      // Integrity must judge the conversation's TRUE tail, not the tail of the
      // filtered subset — with mutationsOnly/type/time filters active, the
      // grouped maxSeq/lastTs can end before unsealed non-matching events and
      // overstate sealed/anchored (codex review P2). Counts stay filtered.
      journal
        .aggregate<{ _id: string; maxSeq: number; lastTs: string }>([
          { $match: { sessionId: { $in: page.map((row) => row._id) } } },
          { $group: { _id: '$sessionId', maxSeq: { $max: '$seq' }, lastTs: { $max: '$ts' } } },
        ])
        .toArray(),
      agentConversations()
        .find(
          { sessionId: { $in: page.map((row) => row._id) } },
          { projection: { sessionId: 1, title: 1, userId: 1 } },
        )
        .toArray(),
      fetchCachedUsers([...new Set(page.flatMap((row) => row.userIds))]),
    ])
    const sealedThroughBySession = new Map(
      sessionStates.map((doc) => [doc._id.slice(2), doc.sealedThrough ?? 0]),
    )
    const tailBySession = new Map(trueTails.map((tail) => [tail._id, tail]))
    const convMeta = new Map(
      convDocs.map((conv) => [
        conv.sessionId,
        { title: conv.title || 'Untitled chat', ownerUserId: conv.userId },
      ]),
    )

    return c.json({
      view,
      conversations: page.map((row) => {
        const tail = tailBySession.get(row._id)
        const trueMaxSeq = tail?.maxSeq ?? row.maxSeq
        const trueLastTs = tail?.lastTs ?? row.lastTs
        const sealed = trueMaxSeq > 0 && (sealedThroughBySession.get(row._id) ?? 0) >= trueMaxSeq
        const anchored =
          sealed && globalState?.lastAnchorAt != null && globalState.lastAnchorAt > trueLastTs
        const meta = convMeta.get(row._id)

        return {
          sessionId: row._id,
          title: meta?.title ?? 'Untitled chat',
          ownerUserId: meta?.ownerUserId ?? null,
          lastTs: row.lastTs,
          firstTs: row.firstTs,
          eventCount: row.eventCount,
          mutationCount: row.mutationCount,
          userIds: row.userIds,
          integrityLevel: anchored
            ? ('anchored' as const)
            : sealed
              ? ('sealed' as const)
              : ('live' as const),
        }
      }),
      users,
      nextCursor: hasMore ? `${page.at(-1)!.lastTs}~${page.at(-1)!._id}` : null,
    })
  })
}
