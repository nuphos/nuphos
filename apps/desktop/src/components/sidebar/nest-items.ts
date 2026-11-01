export type NestedItem<T> = {
  item: T
  depth: number
  /** Per level, whether a later sibling at that level still follows this row. */
  trail: boolean[]
  /** Children are listed under this row, or would be if it were not folded. */
  hasChildren: boolean
  /** Everything under a folded row, so the row can stand in for it. */
  hidden: T[]
  /** Finished children left out of the list, which this row counts instead.
   *  A folded row hides the count along with its children. */
  done: T[]
}

/**
 * Puts each row right after its parent, one level deeper, keeping the given
 * order among siblings. A row whose parent is not in this list — archived,
 * pinned into another section, or unlinked — is simply a top-level row.
 * Rows under a folded parent are left out, and so is a finished child with
 * nothing still listed beneath it: its parent counts it in `done`.
 */
export function nestItems<T extends { key: string; parentKey?: string; finished?: boolean }>(
  items: readonly T[],
  isFolded: (key: string) => boolean = () => false,
): NestedItem<T>[] {
  const keys = new Set(items.map((item) => item.key))
  const children = new Map<string, T[]>()

  for (const item of items) {
    if (item.parentKey && keys.has(item.parentKey)) {
      children.set(item.parentKey, [...(children.get(item.parentKey) ?? []), item])
    }
  }
  // A finished row stays while anything under it still shows, so no row
  // loses the parent it nests under.
  const listed = (item: T): boolean => !item.finished || (children.get(item.key) ?? []).some(listed)
  const nested: NestedItem<T>[] = []
  const below = (key: string): T[] =>
    (children.get(key) ?? []).filter(listed).flatMap((kid) => [kid, ...below(kid.key)])
  const visit = (item: T, trail: boolean[]) => {
    const all = children.get(item.key) ?? []
    const kids = all.filter(listed)
    const folded = kids.length > 0 && isFolded(item.key)

    nested.push({
      item,
      depth: trail.length,
      trail,
      hasChildren: kids.length > 0,
      hidden: folded ? below(item.key) : [],
      done: folded ? [] : all.filter((kid) => !listed(kid)),
    })
    if (folded) return
    kids.forEach((kid, index) => visit(kid, [...trail, index < kids.length - 1]))
  }

  for (const item of items) {
    if (!item.parentKey || !keys.has(item.parentKey)) visit(item, [])
  }

  return nested
}
