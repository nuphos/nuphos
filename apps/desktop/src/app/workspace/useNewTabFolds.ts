import { useCallback, useState } from 'react'

const NEW_TAB_FOLDS_KEY = 'nuphos.newTab.groupFolds'

type Fold = 'open' | 'closed'
type Folds = Record<string, Fold>
type FoldGroup = { key: string; defaultCollapsed?: boolean }

function readFolds(teamId: string): Folds {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(NEW_TAB_FOLDS_KEY) ?? '{}')
    const team = (parsed as Record<string, unknown> | null)?.[teamId]

    return team && typeof team === 'object' ? (team as Folds) : {}
  } catch {
    return {}
  }
}

function writeFolds(teamId: string, folds: Folds) {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(NEW_TAB_FOLDS_KEY) ?? '{}')
    const file = parsed && typeof parsed === 'object' ? parsed : {}

    localStorage.setItem(NEW_TAB_FOLDS_KEY, JSON.stringify({ ...file, [teamId]: folds }))
  } catch {
    // Without storage the fold still applies until the tab closes.
  }
}

// Each New tab group folds on its own, per team. A group nobody has toggled yet
// starts as its caller says, so long connector lists can start folded.
export function useNewTabFolds(teamId: string) {
  const [state, setState] = useState(() => ({ teamId, folds: readFolds(teamId) }))
  const folds = state.teamId === teamId ? state.folds : readFolds(teamId)

  if (state.teamId !== teamId) setState({ teamId, folds })

  const isCollapsed = useCallback(
    ({ key, defaultCollapsed }: FoldGroup) =>
      (folds[key] ?? (defaultCollapsed ? 'closed' : 'open')) === 'closed',
    [folds],
  )
  const toggle = useCallback(
    (group: FoldGroup) => {
      const next: Folds = {
        ...folds,
        [group.key]: isCollapsed(group) ? 'open' : 'closed',
      }

      writeFolds(teamId, next)
      setState({ teamId, folds: next })
    },
    [folds, isCollapsed, teamId],
  )

  return { isCollapsed, toggle }
}
