import { nestItems } from './nest-items.ts'

import type { Item } from './types'

/** A pinned chat's place in Pinned, for the Move up / Move down menu items. */
export type PinnedMoves = { up?: () => void; down?: () => void }

/**
 * Pinned in blocks: each top-level row with every row nested under it, so a
 * pinned chat's sub-agents travel with it. `heads` lists the top-level rows in
 * order, and `headOf` maps any row in Pinned to the block it belongs to.
 */
export function pinnedBlocks(items: readonly Item[]): {
  heads: string[]
  headOf: Map<string, string>
} {
  const heads: string[] = []
  const headOf = new Map<string, string>()

  for (const { item, depth } of nestItems(items)) {
    if (depth === 0) heads.push(item.key)
    const head = heads.at(-1)

    if (head) headOf.set(item.key, head)
  }

  return { heads, headOf }
}

/**
 * The row a one-step move puts `key` in front of: `null` means last, and
 * `undefined` means it cannot move that way.
 */
export function pinnedStepTarget(
  heads: readonly string[],
  key: string,
  step: -1 | 1,
): string | null | undefined {
  const index = heads.indexOf(key)

  if (index === -1) return undefined
  if (step === -1) return index > 0 ? heads[index - 1] : undefined

  return index < heads.length - 1 ? (heads[index + 2] ?? null) : undefined
}
