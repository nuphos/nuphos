import { Profiler } from 'react'

import { WorkspaceTabs } from '../../app/workspace/tabs/WorkspaceTabs'
import { reportShellRender } from '../../lib/tabSwitchLog'

import { useWorkspacePane } from './WorkspacePaneContext'

import type { WorkspaceController } from './useWorkspaceController'

export function WorkspaceTabStrip({ ws, userId }: { ws: WorkspaceController; userId: string }) {
  const pane = useWorkspacePane()
  const {
    databaseConnectionsByTeam,
    tabs,
    activeTabId,
    workspaceActions,
    toggleSidebarCollapsed,
    workspaceDockExpanded,
    accounts,
    copyLink,
    newTab,
    closeTab,
    duplicateTab,
    closeOtherTabs,
    reorderTab,
  } = ws

  return (
    <Profiler id="strip" onRender={(id, _p, ms) => reportShellRender(id, ms)}>
      <WorkspaceTabs
        userId={userId}
        tabs={tabs}
        activeTabId={activeTabId}
        accounts={accounts}
        databaseConnectionsByTeam={databaseConnectionsByTeam}
        onSelect={workspaceActions.activateTab}
        onNew={newTab}
        onClose={closeTab}
        onDuplicate={duplicateTab}
        onCloseOthers={closeOtherTabs}
        onReorder={reorderTab}
        onCopyPageUrl={copyLink}
        // Only an expanded dock reaches the window's corner; docked, the chat header holds the toggle.
        sidebarCollapsed={workspaceDockExpanded && (pane?.cornerPane ?? false)}
        onToggleSidebarCollapse={toggleSidebarCollapsed}
      />
    </Profiler>
  )
}
