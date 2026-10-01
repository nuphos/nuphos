import { getReadableConversation } from '@/lib/agent/db'
import { db } from '@/lib/db'
import { AppError } from '@/lib/errors'
import { JOURNAL_COLLECTION, verifyConversationChain } from '@/lib/journal'
import { SEAL_STATE_COLLECTION } from '@/lib/journal/sealer'
import { resolveVerifiedTeamId } from '@/routes/agent'
import { MAX_EVENTS, contentMatches } from '@/routes/agent-journal/shared'

import type { AuditEvent, JournalDoc } from '@/lib/journal'
import type { SealStateDoc } from '@/lib/journal/sealer'
import type { AuthVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

export function registerAgentJournalSessionRoute(agentJournal: Hono<{ Variables: AuthVariables }>) {
  agentJournal.get('/:sessionId', async (c) => {
    const sessionId = c.req.param('sessionId')
    const userId = c.get('userId')
    const teamId = await resolveVerifiedTeamId(c, c.req.query('teamId'))

    const conversation = await getReadableConversation(sessionId, userId, teamId)

    if (!conversation) {
      throw new AppError(404, 'conversation_not_found', 'Conversation not found')
    }

    const journal = db().collection<JournalDoc>(JOURNAL_COLLECTION)
    const docs = await journal.find({ sessionId }).sort({ seq: 1 }).limit(MAX_EVENTS).toArray()

    let contentDivergenceCount = 0
    const events = docs.map((doc) => {
      const {
        sessionId: _sessionId,
        _id,
        contentHot,
        ...event
      } = doc as JournalDoc & { _id?: unknown }

      if (contentHot === undefined) return event as AuditEvent
      const contentVerified = contentMatches(contentHot, event.payload)

      if (contentVerified === false) contentDivergenceCount += 1

      return { ...(event as AuditEvent), contentHot, contentVerified }
    })

    // One eventId registry across the page AND every tail batch, so duplicate
    // eventIds split across batches are still caught.
    const knownEventIds = new Set<string>()
    const verification = verifyConversationChain(events, { knownEventIds })

    const state = db().collection<SealStateDoc>(SEAL_STATE_COLLECTION)
    // The sealed/anchored verdict must cover the TRUE tail of the conversation,
    // not the tail of a truncated page — otherwise a >MAX_EVENTS conversation
    // could show "sealed" while its newest events are still hot-only.
    const [sessionState, globalState, tailDoc, totalCount] = await Promise.all([
      state.findOne({ _id: `s:${sessionId}` }),
      state.findOne({ _id: '__global__' }),
      journal.findOne(
        { sessionId },
        { sort: { seq: -1 }, projection: { seq: 1, ts: 1, entryHash: 1 } },
      ),
      journal.countDocuments({ sessionId }),
    ])
    const maxSeq = tailDoc?.seq ?? 0
    const sealedThrough = sessionState?.sealedThrough ?? 0
    const sealed = maxSeq > 0 && sealedThrough >= maxSeq
    const lastEventTs = tailDoc?.ts ?? null

    // chainOk AND contentDivergenceCount must cover the WHOLE conversation,
    // not just the returned page (codex review ×2). Tail events are verified
    // in bounded full-document batches: payload hash recomputation, chain
    // linkage, cross-batch eventId dedupe, and contentHot divergence all run
    // exactly as on the first page — only the events themselves are not
    // returned to the client.
    const violations = [...verification.violations]
    let chainOk = verification.ok
    let verifiedThroughSeq = events.at(-1)?.seq ?? 0

    if (totalCount > docs.length && events.length > 0) {
      const TAIL_BATCH = 1000
      let resumeFrom = {
        seq: events.at(-1)!.seq,
        entryHash: events.at(-1)!.entryHash,
      }

      for (;;) {
        const batch = await journal
          .find(
            { sessionId, seq: { $gt: resumeFrom.seq } },
            { sort: { seq: 1 }, limit: TAIL_BATCH },
          )
          .toArray()

        if (batch.length === 0) break
        const batchEvents = batch.map((doc) => {
          const {
            sessionId: _sessionId,
            _id,
            contentHot,
            ...event
          } = doc as JournalDoc & { _id?: unknown }

          if (contentHot !== undefined && contentMatches(contentHot, event.payload) === false) {
            contentDivergenceCount += 1
          }

          return event as AuditEvent
        })
        const tailVerification = verifyConversationChain(batchEvents, { resumeFrom, knownEventIds })

        if (!tailVerification.ok) {
          chainOk = false
          violations.push(...tailVerification.violations)
          break
        }
        const last = batchEvents.at(-1)!

        resumeFrom = { seq: last.seq, entryHash: last.entryHash }
        verifiedThroughSeq = last.seq
        if (batch.length < TAIL_BATCH) break
      }
    }
    const anchored =
      sealed &&
      !!globalState?.lastAnchorAt &&
      !!lastEventTs &&
      globalState.lastAnchorAt > lastEventTs

    return c.json({
      sessionId,
      events,
      integrity: {
        chainOk,
        violationCount: violations.length,
        violations: violations.slice(0, 20),
        eventCount: totalCount,
        /** Full verification (payload + linkage + content) covered 1..verifiedThroughSeq; < maxSeq only when a violation stopped the walk. */
        verifiedThroughSeq,
        truncated: totalCount > docs.length,
        /** entryHash of the conversation's TRUE tail (not the page tail). */
        headHash: tailDoc?.entryHash ?? verification.headHash,
        sealedThrough,
        /** Displayed copies whose hash no longer matches the chain (tampered contentHot). */
        contentDivergenceCount,
        // A divergent display copy downgrades the badge even though the chain
        // itself is intact: "sealed chain" must never read as "what you see is
        // trustworthy" when it isn't (codex review).
        level:
          !chainOk || contentDivergenceCount > 0
            ? ('violated' as const)
            : anchored
              ? ('anchored' as const)
              : sealed
                ? ('sealed' as const)
                : ('live' as const),
        lastAnchorAt: globalState?.lastAnchorAt ?? null,
      },
    })
  })
}
