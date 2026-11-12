export type NestedItem<T> = {
  item: T
  depth: number
  /** Per level, whether a later sibling at that level still follows this row. */
  trail: boolean[]
  /** Children are listed under this row, or would be if it were not folded. */
  hasChildren: boolean
  /** Everything under a folded row, so the row can stand in for it. */
  hidden: T[]
  /** Finished children, which this row counts and folds into its done group.
   *  A folded row hides the count along with its children. */
  done: T[]
}

/**
 * The fold of a row's done group. It starts closed, and like a thread fold
 * it is remembered per team.
 */
export function doneGroup(key: string): { title: string; defaultCollapsed: true } {
  return { title: `${key}:done`, defaultCollapsed: true }
}

/**
 * Puts each row right after its parent, one level deeper, keeping the given
 * order among siblings. A row whose parent is not in this list — archived,
 * pinned into another section, or unlinked — is simply a top-level row.
 * Rows under a folded parent are left out. A finished child with nothing
 * unfinished beneath it goes in its parent's done group: counted in `done`,
 * and listed after the other children only while that group is open.
 */
export function nestItems<T extends { key: string; parentKey?: string; finished?: boolean }>(
  items: readonly T[],
  isFolded: (key: string) => boolean = () => false,
  doneOpen: (key: string) => boolean = () => false,
): NestedItem<T>[] {
  const keys = new Set(items.map((item) => item.key))
  const children = new Map<string, T[]>()

  for (const item of items) {
    if (item.parentKey && keys.has(item.parentKey)) {
      children.set(item.parentKey, [...(children.get(item.parentKey) ?? []), item])
    }
  }
  // A finished row stays out of the done group while anything under it is
  // unfinished, so no running row loses the parent it nests under.
  const settled = (item: T): boolean =>
    Boolean(item.finished) && (children.get(item.key) ?? []).every(settled)
  const doneOf = (key: string): T[] => (children.get(key) ?? []).filter(settled)
  const kidsOf = (key: string): T[] => [
    ...(children.get(key) ?? []).filter((kid) => !settled(kid)),
    ...(doneOpen(key) ? doneOf(key) : []),
  ]
  const nested: NestedItem<T>[] = []
  const below = (key: string): T[] => kidsOf(key).flatMap((kid) => [kid, ...below(kid.key)])
  const visit = (item: T, trail: boolean[]) => {
    const kids = kidsOf(item.key)
    const folded = kids.length > 0 && isFolded(item.key)

    nested.push({
      item,
      depth: trail.length,
      trail,
      hasChildren: kids.length > 0,
      hidden: folded ? below(item.key) : [],
      done: folded ? [] : doneOf(item.key),
    })
    if (folded) return
    kids.forEach((kid, index) => visit(kid, [...trail, index < kids.length - 1]))
  }

  for (const item of items) {
    if (!item.parentKey || !keys.has(item.parentKey)) visit(item, [])
  }

  return nested
}
