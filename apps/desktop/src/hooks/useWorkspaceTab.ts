import { createContext, useContext } from 'react'

export type WorkspaceTabContextValue = {
  /** Stable for the tab's whole life — the key for anything whose lifetime is
   *  the tab's rather than the mounted view's (e.g. a local terminal's PTY). */
  tabId: string
  refreshKey: number
  pollTick: number
  isActive: boolean
}

const DEFAULT_VALUE: WorkspaceTabContextValue = {
  tabId: '',
  refreshKey: 0,
  pollTick: 0,
  isActive: false,
}

export const WorkspaceTabContext = createContext<WorkspaceTabContextValue | null>(null)

export function useWorkspaceTab(): WorkspaceTabContextValue {
  return useContext(WorkspaceTabContext) ?? DEFAULT_VALUE
}
