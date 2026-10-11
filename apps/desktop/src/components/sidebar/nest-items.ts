/**
 * Puts each row right after its parent, one level deeper, keeping the given
 * order among siblings. A row whose parent is not in this list — archived,
 * pinned into another section, or unlinked — is simply a top-level row.
 */
export function nestItems<T extends { key: string; parentKey?: string }>(
  items: readonly T[],
): { item: T; depth: number }[] {
  const keys = new Set(items.map((item) => item.key))
  const children = new Map<string, T[]>()

  for (const item of items) {
    if (item.parentKey && keys.has(item.parentKey)) {
      children.set(item.parentKey, [...(children.get(item.parentKey) ?? []), item])
    }
  }
  const nested: { item: T; depth: number }[] = []
  const visit = (item: T, depth: number) => {
    nested.push({ item, depth })
    for (const child of children.get(item.key) ?? []) visit(child, depth + 1)
  }

  for (const item of items) {
    if (!item.parentKey || !keys.has(item.parentKey)) visit(item, 0)
  }

  return nested
}
