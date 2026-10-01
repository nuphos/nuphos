import type { DatabaseConnection } from '../../../types'
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
  /** No cloud is bound yet: the right-hand dock is setup, not a second chat. */
  firstRunConnectAvailable?: boolean
  onStartFirstRunConnect?: () => void
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
