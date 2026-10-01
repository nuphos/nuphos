type Selection<K extends string> = Record<K, string[] | undefined>

/** Drop selected ids that are absent from `available`.
 *
 *  `available` is the full set of currently-selectable ids per provider, so a
 *  provider added later is covered without touching this function. Providers
 *  are keyed off `available`, never off the stored selection: an id under a key
 *  that no longer exists at all must not survive either. */
export function pruneSelectionToAvailable<K extends string>(
  selection: Partial<Selection<K>>,
  available: Selection<K>,
): Record<K, string[]> {
  const result = {} as Record<K, string[]>

  for (const key of Object.keys(available) as K[]) {
    const valid = new Set(available[key] ?? [])

    result[key] = (selection[key] ?? []).filter((id) => valid.has(id))
  }

  return result
}
