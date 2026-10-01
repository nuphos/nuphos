import type { WorkspaceTabState } from '../workspaceTabState'
import type { MutableRefObject } from 'react'

export type SshTabContext = {
  closedSshTabsRef: MutableRefObject<Set<string>>
  setError: (error: string | null) => void
  openTab: (tab: WorkspaceTabState) => void
  updateTab: (tabId: string, updater: (tab: WorkspaceTabState) => WorkspaceTabState) => void
}
