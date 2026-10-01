import { ObjectId } from 'mongodb'

import {
  MIN_SCORE_TURNS,
  attributionEvents,
  attributionScores,
  attributionTurns,
  computeTurnScorecard,
  countAutoLearnedMemoriesSince,
  filterOwnedMemoryIds,
  resolveLineages,
} from '@/lib/agent/memory-slots/attribution-store'

import { agent } from './router'
import { readTeamIdCandidate, resolveVerifiedTeamId } from './team-scope'

agent.get('/memories/attribution/:sessionId', async (c) => {
  // Track A read surface (analytics, not journal): which tier each memory
  // reached per turn — powers the ribbon's applied/opened badges. The judge
  // lands seconds after the stream closes, so the desktop fetches lazily.
  const userId = c.get('userId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))
  const turnKey = c.req.query('turnKey') || undefined
  const rows = await attributionEvents()
    .find(
      {
        conversationId: c.req.param('sessionId'),
        ...(turnKey ? { turnKey } : {}),
        // Scope-aware: personal-memory rows are stamped with the conversation's
        // teamId, so a plain userId-or-teamId predicate would hand a teammate
        // another user's personal memoryIds + tiers. Personal rows belong to
        // their owner only; team rows to verified team members.
        $or: [
          { scope: 'personal' as const, userId },
          ...(teamId ? [{ scope: 'team' as const, teamId }] : []),
        ],
      },
      // Session-wide reads (no turnKey) back the desktop's one-fetch-per-
      // conversation cache; rows are 3 projected fields, so the higher cap
      // is still a small payload.
      { projection: { memoryId: 1, tier: 1, turnKey: 1 }, limit: turnKey ? 100 : 2000 },
    )
    .toArray()

  return c.json({
    rows: rows.map((r) => ({ memoryId: r.memoryId, tier: r.tier, turnKey: r.turnKey })),
  })
})

agent.get('/memories/scorecard', async (c) => {
  // Track A 2.3: pool health + per-memory retention for the Memories view —
  // the "is memory actually helping" read surface. Same access shape as the
  // attribution route: the caller's own turns plus their verified team's.
  // Analytics only (memory_runtime_*), never journal data.
  const userId = c.get('userId')
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c))
  const now = Date.now()
  // Newest-first so the 5000-row safety cap clips the OLDEST turns; an
  // unordered cap would freeze the stats on whatever subset Mongo returns.
  // Indexes {teamId,at}/{userId,at} back this read.
  const turnRows = await attributionTurns()
    .find(
      {
        at: { $gte: new Date(now - 90 * 24 * 60 * 60 * 1000) },
        $or: [{ userId }, ...(teamId ? [{ teamId }] : [])],
      },
      { limit: 5000, sort: { at: -1 } },
    )
    .toArray()
  const summary = computeTurnScorecard(turnRows)
  const learnedLast7d = await countAutoLearnedMemoriesSince(
    userId,
    teamId,
    new Date(now - 7 * 24 * 60 * 60 * 1000),
  )
  // Per-memory retention for the ids the caller is actually looking at.
  // ids are caller-supplied, so ownership is CHECKED (in the attribution
  // store's native-read helper), not assumed: score docs carry no userId, and
  // personal memories recalled in team conversations produce team-stamped
  // rows — without this filter a teammate could read another user's
  // personal-memory stats from ids seen in shared transcripts.
  const idsParam = (c.req.query('ids') ?? '').trim()
  const requestedIds = idsParam
    ? idsParam
        .split(',')
        .map((s) => s.trim())
        .filter((s) => ObjectId.isValid(s))
        // Canonical lowercase hex: ObjectId accepts uppercase too, but every
        // downstream comparison (ownership set, lineage keys, score map) is
        // keyed by the store's lowercase form.
        .map((s) => new ObjectId(s).toHexString())
        .slice(0, 100)
    : []
  const ids = requestedIds.length ? await filterOwnedMemoryIds(userId, teamId, requestedIds) : []
  const scores: Record<
    string,
    {
      turns: number
      applied: number
      applyRate: number
      corrections: number
      reachConversations: number
      reachUsers: number
      lastAppliedAt: string | null
      proven: boolean
    }
  > = {}

  if (ids.length) {
    const lineageByMemory = await resolveLineages(ids)
    const docs = await attributionScores()
      .find({
        provider: 'native',
        teamId: { $in: teamId ? [teamId, null] : [null] },
        lineage: { $in: [...new Set(lineageByMemory.values())] },
      })
      .toArray()
    const byLineage = new Map<string, typeof docs>()

    for (const d of docs) {
      const g = byLineage.get(d.lineage)

      if (g) g.push(d)
      else byLineage.set(d.lineage, [d])
    }
    for (const [memoryId, lineage] of lineageByMemory) {
      const g = byLineage.get(lineage)

      if (!g?.length) continue
      // A lineage can hold a team-context and a personal-context score doc;
      // sum them for display (reach sums slightly over-count if the same
      // conversation appeared in both — it can't, contexts are disjoint).
      const turns = g.reduce((a, d) => a + d.turns, 0)
      const applied = g.reduce((a, d) => a + d.applied, 0)
      const lastAppliedAt = g.reduce<Date | null>(
        (a, d) => (d.lastAppliedAt && (!a || d.lastAppliedAt > a) ? d.lastAppliedAt : a),
        null,
      )

      scores[memoryId] = {
        turns,
        applied,
        applyRate: turns ? applied / turns : 0,
        corrections: g.reduce((a, d) => a + d.corrections, 0),
        reachConversations: g.reduce((a, d) => a + d.reachConversations, 0),
        reachUsers: g.reduce((a, d) => a + d.reachUsers, 0),
        lastAppliedAt: lastAppliedAt ? lastAppliedAt.toISOString() : null,
        proven: turns >= MIN_SCORE_TURNS,
      }
    }
  }

  return c.json({ summary: { ...summary, learnedLast7d, windowDays: 90 }, scores })
})
