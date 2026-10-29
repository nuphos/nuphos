// Turn-end free-signal capture (Track A 1.2): fetched attribution
// rows + the per-turn denominator row. No LLM. Fire-and-forget from the
// finalizer — callers MUST void+catch; nothing here may throw into the turn.
import { attributionTurns, recordAttributionSignal } from './attribution-store'

import type { AttributionSignal, MemoryScope } from './attribution-types'

export async function captureTurnAttribution(input: {
  /** Resolved provider id, stamped by the RUNTIME at the call boundary
   * (decision 3). Defaults to 'native' so pre-swap finalizer callers stay
   * green until they pass the turn resolution's id. */
  provider?: string
  teamId: string | null
  userId: string
  conversationId: string // == sessionId (purge joins on this)
  turnKey: string // == requestId
  fetchedTeamIds: string[]
  fetchedPersonalIds: string[]
  // Track A 2.1: old memories a save_memory supersede corrected this turn —
  // the negative signal ("was wrong enough to replace"), tier not_applicable.
  supersededTeamIds?: string[]
  supersededPersonalIds?: string[]
}): Promise<void> {
  const at = new Date()
  const provider = input.provider ?? 'native'
  const base = {
    provider,
    teamId: input.teamId,
    userId: input.userId,
    conversationId: input.conversationId,
    turnKey: input.turnKey,
    lineage: null,
  }
  // SEQUENTIAL on purpose: a memory that was fetched AND superseded gets two
  // writes to the SAME row, and recordAttributionSignal is read-modify-write —
  // concurrent writes lose one signal. Fire-and-forget: latency is free.
  const writes: [string, MemoryScope, AttributionSignal][] = [
    ...input.fetchedTeamIds.map((id): [string, MemoryScope, AttributionSignal] => [
      id,
      'team',
      'fetch_log',
    ]),
    ...input.fetchedPersonalIds.map((id): [string, MemoryScope, AttributionSignal] => [
      id,
      'personal',
      'fetch_log',
    ]),
    ...(input.supersededTeamIds ?? []).map((id): [string, MemoryScope, AttributionSignal] => [
      id,
      'team',
      'supersede_correction',
    ]),
    ...(input.supersededPersonalIds ?? []).map((id): [string, MemoryScope, AttributionSignal] => [
      id,
      'personal',
      'supersede_correction',
    ]),
  ]

  for (const [memoryId, scope, signal] of writes) {
    await recordAttributionSignal({ ...base, memoryId, scope, signal: { signal, at } })
  }

  // Written even at zero fetches: this row is the per-turn denominator.
  // judge defaults to skipped_disabled; 1.3's judge overwrites it afterward
  // (capture and judge are chained in one fire-and-forget, so no write race).
  await attributionTurns().updateOne(
    { conversationId: input.conversationId, turnKey: input.turnKey },
    {
      $set: {
        provider,
        teamId: input.teamId,
        userId: input.userId,
        fetchedCount: input.fetchedTeamIds.length + input.fetchedPersonalIds.length,
        judge: 'skipped_disabled',
        appliedCount: 0,
        at,
      },
    },
    { upsert: true },
  )
}
