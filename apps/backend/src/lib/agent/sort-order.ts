/**
 * Ordering identical to `Array.prototype.sort()` with no comparator: UTF-16
 * code units, not locale collation. Callers that feed hashes, canonical JSON,
 * or asserted fixtures need this exact order, so `localeCompare` is not a
 * substitute.
 */
export function byCodeUnit(a: string, b: string): number {
  if (a < b) return -1

  return a > b ? 1 : 0
}
