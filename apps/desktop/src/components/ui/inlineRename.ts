/** What committing a rename does: nothing, or save `label` and show `shown` until it lands. */
export type RenameOutcome = { save: false } | { save: true; label: string; shown: string }

/**
 * An unchanged name is no change. An empty one restores `defaultName` where there is one
 * (it is saved as ''), and is no change where there is none.
 */
export function renameOutcome(draft: string, current: string, defaultName?: string): RenameOutcome {
  const label = draft.trim()

  if (label) return label === current ? { save: false } : { save: true, label, shown: label }
  if (defaultName === undefined || current === defaultName) return { save: false }

  return { save: true, label: '', shown: defaultName }
}
