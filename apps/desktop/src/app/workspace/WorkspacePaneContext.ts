import { createContext, useContext } from 'react'

import { PRIMARY_PANE_ID } from '../../lib/chatSummaryPanel'

import type { SidebarSlot } from './sidebarSlot'
import type { WorkspaceState } from './store/workspaceState'
import type { WorkspaceStore } from './store/workspaceStore'
import type { Dispatch, SetStateAction } from 'react'

export type WorkspacePaneValue = {
  paneId: string
  sessionSearchOpen: boolean
  setSessionSearchOpen: Dispatch<SetStateAction<boolean>>
  focusSession: (sessionId: string, teamId?: string) => boolean
  openSessionBeside: (sessionId: string, teamId?: string) => boolean
  sidebarCollapsed: boolean
  toggleSidebarCollapsed: () => void
  /** The sidebar is collapsed and this pane sits in the window's top-left corner. */
  cornerPane: boolean
  isTabFocused: () => boolean
  closePane: () => void
  closeOtherPanes: () => void
  /** More than one pane is showing, so this one can be closed. */
  split: boolean
  active: boolean
  /** The window's one sidebar; the active pane hands it what to show. */
  sidebar: SidebarSlot
  initialState?: WorkspaceState
  registerStore: (store: WorkspaceStore) => () => void
  /** How this pane opens a Nuphos link someone outside it asked for; only the focused pane is asked. */
  registerLinkOpener: (paneId: string, open: (href: string) => unknown) => () => void
}

export const WorkspacePaneContext = createContext<WorkspacePaneValue | null>(null)

export function useWorkspacePane() {
  return useContext(WorkspacePaneContext)
}

/** The id of the pane this component sits in; outside any pane, the primary one. */
export function usePaneId(): string {
  return useContext(WorkspacePaneContext)?.paneId ?? PRIMARY_PANE_ID
}
