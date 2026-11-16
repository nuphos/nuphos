/**
 * A parent row's one expand control. Under the hood the row has two folds: the
 * thread fold (hides every child) and its done group (lists finished children
 * after the running ones). The chevron at the row's edge drives both.
 *
 * - `expanded`: every child is listed. The chevron collapses.
 * - `partial`: running children are listed, finished ones are not. The
 *   chevron expands.
 * - `collapsed`: the thread fold hides every child. The chevron expands.
 * - `none`: no children.
 */
export type RowExpansion = 'none' | 'collapsed' | 'partial' | 'expanded'

export type RowExpandInput = {
  /** Children are listed, or would be if the row were not folded. */
  hasChildren: boolean
  /** The thread fold hides the listed children. */
  folded: boolean
  /** Some child is unfinished. */
  running: boolean
  /** Some child is finished. */
  hasDone: boolean
  /** The done group is open. */
  doneOpen: boolean
}

export function rowExpansion(row: RowExpandInput): RowExpansion {
  if (!row.hasChildren && !row.hasDone) return 'none'
  if (row.folded) return 'collapsed'
  if (row.hasDone && !row.doneOpen) return 'partial'

  return 'expanded'
}

export type RowExpandActions = {
  /** The raw thread fold, which may be set while no child is listed. */
  foldSet: boolean
  toggleFold: () => void
  toggleDone: () => void
}

/** One click on the chevron: expand lists every child, collapse hides them. */
export function toggleRowExpansion(row: RowExpandInput, actions: RowExpandActions): void {
  const state = rowExpansion(row)

  if (state === 'none') return
  if (state === 'expanded') {
    // With running children, fold them all; with only finished ones, close
    // the done group so the row is back to its count.
    if (row.running) actions.toggleFold()
    else actions.toggleDone()

    return
  }
  // Clear the thread fold too: a Bot tree is folded at rest, and opening only
  // its done group would leave the opened rows folded away.
  if (actions.foldSet) actions.toggleFold()
  if (row.hasDone && !row.doneOpen) actions.toggleDone()
}
