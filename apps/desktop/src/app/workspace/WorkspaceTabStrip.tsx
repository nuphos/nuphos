import { ArrowLeft, Maximize2, Minimize2 } from 'lucide-react'
import { Profiler } from 'react'

import { WorkspaceTabs } from '../../app/workspace/tabs/WorkspaceTabs'
import { IconButton } from '../../components/ui/icon-button'
import { t } from '../../i18n'
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
    setWorkspaceDockExpanded,
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
        leading={
          // Expanded, the dock covers the chat; say where the way back leads.
          workspaceDockExpanded && (
            <button
              type="button"
              onClick={() => setWorkspaceDockExpanded(false)}
              className="titlebar-no-drag ml-2 flex h-7 flex-shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-secondary outline-none transition-colors hover:bg-state-hover hover:text-primary focus-visible:ring-2 focus-visible:ring-line-focus"
            >
              <ArrowLeft className="size-4" strokeWidth={1.7} />
              {t('Back to conversation')}
            </button>
          )
        }
        trailing={
          <IconButton
            label={
              workspaceDockExpanded ? t('Restore workspace panel') : t('Expand workspace panel')
            }
            shortcut="mod+shift+enter"
            icon={
              workspaceDockExpanded ? (
                <Minimize2 strokeWidth={1.7} />
              ) : (
                <Maximize2 strokeWidth={1.7} />
              )
            }
            aria-pressed={workspaceDockExpanded}
            onClick={() => setWorkspaceDockExpanded((expanded) => !expanded)}
            className="titlebar-no-drag"
          />
        }
      />
    </Profiler>
  )
}
