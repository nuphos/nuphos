import type { Item } from './types'

/**
 * The first status among what a folded thread hides. Renders nothing at all
 * when none shows, so an idle row's trailing slot stays empty and takes no space.
 */
export function FoldedStatus({ rows }: { rows: Item[] }) {
  return rows.find((row) => row.foldedStatus != null)?.foldedStatus ?? null
}
