import { Profiler } from 'react'

import { WorkspaceTabs } from '../../app/workspace/tabs/WorkspaceTabs'
import { reportShellRender } from '../../lib/tabSwitchLog'
import { ONBOARDING_EXTRA_STEPS_ENABLED } from '../../views/onboarding/onboardingSteps'

import type { WorkspaceController } from './useWorkspaceController'

export function WorkspaceTabStrip({ ws, userId }: { ws: WorkspaceController; userId: string }) {
  const {
    databaseConnectionsByTeam,
    tabs,
    activeTabId,
    workspaceActions,
    sidebarCollapsed,
    toggleSidebarCollapsed,
    firstRunPanelOpen,
    startFirstRunConnect,
    accounts,
    firstRunCloudUnbound,
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
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebarCollapse={toggleSidebarCollapsed}
        firstRunConnectAvailable={ONBOARDING_EXTRA_STEPS_ENABLED && firstRunCloudUnbound}
        onStartFirstRunConnect={firstRunPanelOpen ? undefined : startFirstRunConnect}
      />
    </Profiler>
  )
}
