import { useWorkspaceAccounts } from './useWorkspaceAccounts'
import { useWorkspaceActiveTab } from './useWorkspaceActiveTab'
import { useWorkspaceAgentLinks } from './useWorkspaceAgentLinks'
import { useWorkspaceBreadcrumb } from './useWorkspaceBreadcrumb'
import { useWorkspaceChatLinks } from './useWorkspaceChatLinks'
import { useWorkspaceClusterEntry } from './useWorkspaceClusterEntry'
import { useWorkspaceInvitations } from './useWorkspaceInvitations'
import { useWorkspaceLinkOpeners } from './useWorkspaceLinkOpeners'
import { useWorkspaceNamespaces } from './useWorkspaceNamespaces'
import { useWorkspaceRefresh } from './useWorkspaceRefresh'
import { useWorkspaceScopeActions } from './useWorkspaceScopeActions'
import { useWorkspaceShellState } from './useWorkspaceShellState'
import { useWorkspaceShortcuts } from './useWorkspaceShortcuts'
import { useWorkspaceSidebarNav } from './useWorkspaceSidebarNav'
import { useWorkspaceTabLifecycle } from './useWorkspaceTabLifecycle'
import { useWorkspaceTabSync } from './useWorkspaceTabSync'
import { useWorkspaceTakeover } from './useWorkspaceTakeover'
import { useWorkspaceTeamResources } from './useWorkspaceTeamResources'
import { useWorkspaceTeams } from './useWorkspaceTeams'
import { useWorkspaceTeamsSync } from './useWorkspaceTeamsSync'
import { useWorkspaceToolbar } from './useWorkspaceToolbar'

import type { WorkspaceProps } from './workspaceProps'

export function useWorkspaceController(props: WorkspaceProps) {
  const acc0 = { ...props }
  const s1 = useWorkspaceShellState()
  const acc1 = { ...acc0, ...s1 }
  const s2 = useWorkspaceActiveTab(acc1)
  const acc2 = { ...acc1, ...s2 }
  const s3 = useWorkspaceTabSync(acc2)
  const acc3 = { ...acc2, ...s3 }
  const s4 = useWorkspaceTeams(acc3)
  const acc4a = { ...acc3, ...s4 }
  const s4b = useWorkspaceTeamsSync(acc4a)
  const acc4 = { ...acc4a, ...s4b }
  const s5 = useWorkspaceInvitations(acc4)
  const acc5 = { ...acc4, ...s5 }
  const s6 = useWorkspaceTeamResources(acc5)
  const acc6 = { ...acc5, ...s6 }
  const s7 = useWorkspaceNamespaces(acc6)
  const acc7 = { ...acc6, ...s7 }
  const s8 = useWorkspaceAccounts(acc7)
  const acc8 = { ...acc7, ...s8 }
  const s9 = useWorkspaceScopeActions(acc8)
  const acc9 = { ...acc8, ...s9 }
  const s10 = useWorkspaceAgentLinks(acc9)
  const acc10 = { ...acc9, ...s10 }
  const s11 = useWorkspaceTakeover(acc10)
  const acc11 = { ...acc10, ...s11 }
  const s12 = useWorkspaceClusterEntry(acc11)
  const acc12 = { ...acc11, ...s12 }
  const s13 = useWorkspaceSidebarNav(acc12)
  const acc13 = { ...acc12, ...s13 }
  const s14 = useWorkspaceBreadcrumb(acc13)
  const acc14a = { ...acc13, ...s14 }
  const s14b = useWorkspaceRefresh(acc14a)
  const acc14 = { ...acc14a, ...s14b }
  const s15 = useWorkspaceToolbar(acc14)
  const acc15 = { ...acc14, ...s15 }
  const s16 = useWorkspaceLinkOpeners(acc15)
  const acc16 = { ...acc15, ...s16 }
  const s17 = useWorkspaceChatLinks(acc16)
  const acc17 = { ...acc16, ...s17 }
  const s18 = useWorkspaceTabLifecycle(acc17)
  const acc18 = { ...acc17, ...s18 }
  const s19 = useWorkspaceShortcuts(acc18)
  const acc19 = { ...acc18, ...s19 }

  return acc19
}

export type WorkspaceController = ReturnType<typeof useWorkspaceController>
