import type { DatabaseConnection } from '../../../types'
import type { ReactNode } from 'react'
import type { AccountSet, WorkspaceTabState } from '../../workspaceTabState'

export type TabDropPlacement = 'before' | 'after'

export type WorkspaceTabsProps = {
  userId: string
  tabs: WorkspaceTabState[]
  activeTabId: string | null
  accounts: AccountSet | undefined
  databaseConnectionsByTeam: Record<string, DatabaseConnection[] | undefined>
  onSelect: (id: string) => void
  onNew: () => void
  onClose: (id: string) => void
  onDuplicate: (id: string) => void
  onCloseOthers: (id: string) => void
  onReorder: (tabId: string, targetTabId: string, placement: TabDropPlacement) => void
  onCopyPageUrl: (href: string) => void | Promise<void>
  sidebarCollapsed?: boolean
  onToggleSidebarCollapse?: () => void
  /** Shown before the tabs, e.g. the way back from an expanded dock. */
  leading?: ReactNode
  /** Shown after the tabs, at the strip's trailing end. */
  trailing?: ReactNode
}

export type TabContextMenuState = {
  tabId: string
  href: string
  appHref: string
  title: string
  teamId: string
  x: number
  y: number
}
