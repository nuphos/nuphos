/** Start offsets of every case-insensitive, non-overlapping `query` match in `text`. */
export function findOffsets(text: string, query: string): number[] {
  if (!query) return []
  // A regex rather than lowercasing both sides: lowercasing can change a
  // string's length ('İ'), which would shift every later offset.
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')

  return [...text.matchAll(pattern)].map((match) => match.index)
}
