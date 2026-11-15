/**
 * The Bot a row works under: the nearest one up its parents, starting at `start`.
 * An unlisted parent ends the walk, so a row whose Bot cannot be found stands alone.
 */
export function nearestBot<T>(
  start: string | undefined,
  rowOf: (id: string) => T | undefined,
  isBot: (row: T) => boolean,
  parentOf: (row: T) => string | undefined,
): T | undefined {
  const seen = new Set<string>()
  let parent = start

  while (parent && !seen.has(parent)) {
    seen.add(parent)
    const row = rowOf(parent)

    if (!row) return undefined
    if (isBot(row)) return row
    parent = parentOf(row)
  }

  return undefined
}
