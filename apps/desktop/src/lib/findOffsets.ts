/**
 * Start offsets of the first `limit` case-insensitive, non-overlapping `query`
 * matches in `text`.
 */
export function findOffsets(text: string, query: string, limit = Infinity): number[] {
  if (!query) return []
  // A regex rather than lowercasing both sides: lowercasing can change a
  // string's length ('İ'), which would shift every later offset.
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')

  const offsets: number[] = []

  for (const match of text.matchAll(pattern)) {
    if (offsets.length === limit) break
    offsets.push(match.index)
  }

  return offsets
}
