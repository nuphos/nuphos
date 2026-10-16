import type { Item, Section } from './types'

export const DONE_FOLD_PREFIX = 'thread-done:'

/** A single finished thread stays in view; the fold starts saving rows at two. */
const MIN_FOLDED = 2

type Row = { key: string; parentKey?: string; threadDone?: boolean; active?: boolean }

export function doneFoldKey(parentKey: string): string {
  return `${DONE_FOLD_PREFIX}${parentKey}`
}

/**
 * Moves each chat's finished threads behind one "N done" row placed after its
 * running threads, so finished work stops piling up while running work stays
 * on top. A thread counts as finished only with all of its own threads
 * finished too. Open folds list their threads after the row; closed ones leave
 * them out and the row takes the highlight of an open chat inside, the way a
 * folded parent does. Only the user's click opens a fold (#432).
 */
export function foldDoneThreads<T extends Row>(
  items: readonly T[],
  isOpen: (parentKey: string) => boolean,
  foldRow: (parentKey: string, count: number, open: boolean, active: boolean) => T,
): T[] {
  const keys = new Set(items.map((item) => item.key))
  const kids = new Map<string, T[]>()

  for (const item of items) {
    if (item.parentKey && keys.has(item.parentKey))
      kids.set(item.parentKey, [...(kids.get(item.parentKey) ?? []), item])
  }
  const settled = (item: T, seen = new Set<string>()): boolean =>
    Boolean(item.threadDone) &&
    !seen.has(item.key) &&
    (kids.get(item.key) ?? []).every((kid) => settled(kid, new Set(seen).add(item.key)))
  const subtree = (item: T): T[] => [item, ...(kids.get(item.key) ?? []).flatMap(subtree)]
  const hidden = new Set<string>()
  const folds: T[] = []
  const visit = (item: T) => {
    const done = (kids.get(item.key) ?? []).filter((kid) => settled(kid))

    if (done.length >= MIN_FOLDED) {
      const rows = done.flatMap(subtree)
      const open = isOpen(item.key)

      for (const row of rows) hidden.add(row.key)
      const active = !open && rows.some((row) => row.active)

      folds.push(foldRow(item.key, done.length, open, active), ...(open ? rows : []))
    }
    for (const kid of kids.get(item.key) ?? []) if (!hidden.has(kid.key)) visit(kid)
  }

  for (const item of items) if (!item.parentKey || !keys.has(item.parentKey)) visit(item)
  if (folds.length === 0) return [...items]

  return [...items.filter((item) => !hidden.has(item.key)), ...folds]
}

export type GroupState = Pick<Section, 'title' | 'defaultCollapsed'>
export type DoneFold = { parentKey: string; count: number; open: boolean; active: boolean }

// Finished threads start folded; opening a fold is remembered like any group.
export const foldGroup = (parentKey: string): GroupState => ({
  title: doneFoldKey(parentKey),
  defaultCollapsed: true,
})

/** A section's rows with each chat's finished threads behind one "N done" row. */
export function withDoneFolds(
  items: Item[],
  isGroupCollapsed: (group: GroupState) => boolean,
): { rows: Item[]; foldOf: (item: Item) => DoneFold | undefined } {
  const folds = new Map<string, DoneFold>()
  const rows = foldDoneThreads(
    items,
    (parentKey) => !isGroupCollapsed(foldGroup(parentKey)),
    (parentKey, count, open, active) => {
      folds.set(doneFoldKey(parentKey), { parentKey, count, open, active })

      return {
        key: doneFoldKey(parentKey),
        label: `${String(count)} done`,
        parentKey,
        enabled: true,
        active,
      }
    },
  )

  return {
    rows,
    foldOf: (item) => (item.key.startsWith(DONE_FOLD_PREFIX) ? folds.get(item.key) : undefined),
  }
}
