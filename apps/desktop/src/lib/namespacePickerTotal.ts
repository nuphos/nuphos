/**
 * Derives the namespace picker's truncation state from a Kubernetes list's
 * metadata.
 *
 * The split matters: `continueToken` is the only signal the API guarantees,
 * while `remainingItemCount` is explicitly optional — the conventions allow a
 * server to omit it when the value isn't cheaply available. Letting the count
 * decide truncation makes such a server present a capped list as the whole
 * cluster, which is the exact thing the disclaimer exists to prevent.
 */
export function namespacePickerTotals(meta: {
  fetched: number
  continueToken?: string | null
  remainingItemCount?: number | string | null
}): { truncated: boolean; total: number | null } {
  const truncated = Boolean(meta.continueToken)
  // `Number(null)` is 0, so an explicitly-null count would otherwise read as
  // "zero remaining" and report the fetched page as the whole cluster.
  const raw = meta.remainingItemCount
  const remaining = raw == null ? Number.NaN : Number(raw)

  return {
    truncated,
    total: truncated && Number.isFinite(remaining) ? meta.fetched + remaining : null,
  }
}
