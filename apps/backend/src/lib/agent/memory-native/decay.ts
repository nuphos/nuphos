// ADR-0008 rung 3, ranking half — access-decay index ordering.
//
// Built ahead behind MEMORY_INDEX_RANKING=decay (default recency). Rank =
// recency-of-last-signal × fetch-frequency, where the recency clock takes the
// NEWEST of updatedAt (write), lastFetchedAt (relevance, rung 0.5) and
// lastVerifiedAt (trust — only outcome signals write it; playbooks only for now),
// per the two-clocks rule. 0.995^hours is the Generative Agents constant —
// a ~5.8-day half-life; fetch frequency enters log-damped so a
// often-fetched memory cannot pin the index forever.
//
// The archive half of rung 3 (drop below threshold) is deliberately NOT
// built: thresholds picked before fetch history exists would be theater.
// Decay reorders; it never hides anything the pool holds.

export type DecayInputs = {
  updatedAt: Date
  lastFetchedAt?: Date
  lastVerifiedAt?: Date
  fetchCount?: number
}

const DECAY_PER_HOUR = 0.995

export function decayScore(now: Date, doc: DecayInputs): number {
  const effective = Math.max(
    doc.updatedAt.getTime(),
    doc.lastFetchedAt?.getTime() ?? 0,
    doc.lastVerifiedAt?.getTime() ?? 0,
  )
  const hours = Math.max(0, (now.getTime() - effective) / 3_600_000)

  return DECAY_PER_HOUR ** hours * (1 + Math.log1p(doc.fetchCount ?? 0))
}

// Order docs by decay score descending, tie-broken by updatedAt descending so
// the flag flip is deterministic against the old ordering.
export function rankByDecay<T extends DecayInputs>(now: Date, docs: T[]): T[] {
  return [...docs].sort((a, b) => {
    const diff = decayScore(now, b) - decayScore(now, a)

    if (diff !== 0) return diff

    return b.updatedAt.getTime() - a.updatedAt.getTime()
  })
}
