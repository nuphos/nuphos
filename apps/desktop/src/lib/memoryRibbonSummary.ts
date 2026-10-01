// Verified-use count for ONE section, counted from the very entries that
// section lists. Counting turn-wide instead lets a row that lists five
// memories report "used 9" — the other section's verdicts measured against
// this one's denominator, and a header that contradicts the badges under it.
export function appliedCount(
  entries: readonly { id: string }[],
  tiers: Readonly<Record<string, string>>,
): number {
  return entries.filter((e) => tiers[e.id] === 'applied').length
}

export type ProvenanceSummaryInput = {
  automatic: boolean
  indexRide: boolean
  usedCount: number
  loadedCount: number
  recalledCount: number
}

const memories = (n: number) => `${String(n)} ${n === 1 ? 'memory' : 'memories'}`

// Settled wording ladder for the provenance ribbon. Automatic mode: verified
// use wins; otherwise one merged recall count (turn-start recall + the
// agent's own lookups — the expanded list splits them into their two
// sections). Index-ride/legacy modes keep their original shown/loaded
// framing.
export function provenanceSummary({
  automatic,
  indexRide,
  usedCount,
  loadedCount,
  recalledCount,
}: ProvenanceSummaryInput): string {
  if (automatic) {
    // Reads as the step it is — the first thing the turn did, above the tool
    // rows — so it stays in the same "action, then result" voice as they do.
    if (usedCount > 0) return `Recalled ${memories(recalledCount)} · used ${String(usedCount)}`

    return `Recalled ${memories(recalledCount)}`
  }
  if (recalledCount > 0 && !indexRide) {
    const loaded = loadedCount > 0 ? ` · ${String(loadedCount)} loaded` : ''

    return `${memories(recalledCount)} shown${loaded}`
  }

  return `${memories(loadedCount)} loaded${recalledCount > 0 ? '' : ' via search'}`
}
