import type { Item } from '../components/sidebar/types'
import type { ReactNode } from 'react'

/**
 * How well a launcher label matches a typed query, lower is better: the label
 * starts with it, then a word in it does, then it appears anywhere. `null`
 * means no match. Typing `t` therefore puts "Terminal" ahead of "Plans".
 */
export function launcherMatchRank(label: string, query: string): number | null {
  const text = label.toLocaleLowerCase()
  const needle = query.trim().toLocaleLowerCase()

  if (!needle || text.startsWith(needle)) return 0
  if (text.split(/[\s\-_/.()]+/u).some((word) => word.startsWith(needle))) return 1

  return text.includes(needle) ? 2 : null
}

/** One row the keyboard can land on. Every visible destination — favorite,
 *  workspace page, connector or history entry — is one of these, in display
 *  order, so ↑/↓ and Enter work the same across all of them. */
export type NewTabOption = {
  id: string
  label: string
  detail?: string
  icon: ReactNode
  item?: Item
  /** Already matched elsewhere (history matches on URL too), so it stays in
   *  the results behind every label hit instead of being filtered out. */
  fallbackMatch?: boolean
  open: (newTab: boolean) => void
}

export const newTabOptionDomId = (index: number) => `new-tab-option-${String(index)}`

/** Ranks options by how well their label matches the query. The sort is
 *  stable, so ties keep the page's order. */
export function rankNewTabOptions(options: NewTabOption[], query: string): NewTabOption[] {
  return options
    .map((option) => ({
      option,
      rank: launcherMatchRank(option.label, query) ?? (option.fallbackMatch ? 3 : null),
    }))
    .filter((entry): entry is { option: NewTabOption; rank: number } => entry.rank !== null)
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => entry.option)
}
