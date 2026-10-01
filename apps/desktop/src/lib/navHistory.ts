import { pageLocationForNavigation } from './appRoutes.ts'

import type { NavigationSnapshot } from './appRoutes.ts'

/**
 * Per-tab back/forward stack. `navHistoryIndex` points at the entry the tab is
 * currently showing; entries after it are the forward stack.
 */
export type NavHistory = {
  navHistory: NavigationSnapshot[]
  navHistoryIndex: number
}

/** Entries kept per tab. Older ones fall off the back of the stack. */
export const NAV_HISTORY_LIMIT = 50

/**
 * A navigation's identity is its URL — the same string the tab strip and the
 * route table already agree on. Deriving it from the whole snapshot (rather
 * than from a hand-listed set of fields) is what keeps history from silently
 * missing drill-downs when `NavigationSnapshot` grows a new field.
 */
export function navigationKey(snapshot: NavigationSnapshot): string {
  return pageLocationForNavigation(snapshot).href
}

export function sameNavigation(a: NavigationSnapshot | undefined, b: NavigationSnapshot): boolean {
  return !!a && navigationKey(a) === navigationKey(b)
}

/**
 * Record a move to `next`, dropping any forward stack. A move to the page the
 * tab is already on is not a navigation and leaves the history untouched.
 */
export function pushNavigation(state: NavHistory, next: NavigationSnapshot): NavHistory {
  const current = state.navHistory[state.navHistoryIndex]

  if (sameNavigation(current, next)) return state
  const navHistory = [...state.navHistory.slice(0, state.navHistoryIndex + 1), next].slice(
    -NAV_HISTORY_LIMIT,
  )

  return { navHistory, navHistoryIndex: navHistory.length - 1 }
}

/**
 * Rewrite the entry the tab is sitting on. For changes that refine the current
 * page rather than leave it — typing in the search box, which some pages encode
 * into their URL — so Back exits the page instead of unwinding keystrokes,
 * while the entry keeps the latest state for restore and copy-URL.
 */
export function replaceNavigation(state: NavHistory, next: NavigationSnapshot): NavHistory {
  const current = state.navHistory[state.navHistoryIndex]

  // Written even when the URL is unchanged: a snapshot carries state the URL
  // does not — a list filter is in the entry on every page, and in the path on
  // only a few — and skipping the write left Back restoring a stale one.
  if (!current) return pushNavigation(state, next)
  const navHistory = [...state.navHistory]

  navHistory[state.navHistoryIndex] = next

  return { navHistory, navHistoryIndex: state.navHistoryIndex }
}

/**
 * History for a tab opened *from* another tab: the source tab's back stack up
 * to what the user was looking at, with the new page on top. Back therefore
 * returns to the page the tab was opened from instead of dead-ending — the
 * whole point of routing every "open in a new tab" through one helper.
 */
export function inheritNavigation(source: NavHistory, next: NavigationSnapshot): NavHistory {
  const behind = source.navHistory.slice(0, source.navHistoryIndex + 1)
  // Only the tail belonging to the same team as `next`. A tab can be
  // retargeted across teams in place — a deep link landing on an open tab does
  // exactly that — so its stack can hold entries for a team the new tab was
  // never in, and walking Back into one would silently change which team the
  // tab is showing.
  let start = behind.length

  while (start > 0 && behind[start - 1].scope.teamId === next.scope.teamId) {
    start -= 1
  }
  const sameTeam = behind.slice(start)

  if (sameTeam.length === 0) return { navHistory: [next], navHistoryIndex: 0 }

  return pushNavigation({ navHistory: sameTeam, navHistoryIndex: sameTeam.length - 1 }, next)
}

/** The entry `direction` steps away, or null when that end is reached. */
export function stepNavigation(
  state: NavHistory,
  direction: -1 | 1,
): { snapshot: NavigationSnapshot; index: number } | null {
  const index = state.navHistoryIndex + direction
  const snapshot = state.navHistory[index]

  return snapshot ? { snapshot, index } : null
}

export function canStepNavigation(state: NavHistory, direction: -1 | 1): boolean {
  return stepNavigation(state, direction) !== null
}
