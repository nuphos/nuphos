import { useEffect } from 'react'

import type { useWorkspaceController } from './useWorkspaceController'

type WorkspaceController = ReturnType<typeof useWorkspaceController>

export function useWorkspaceTabMigrations(ws: WorkspaceController) {
  const { activeTab, workspaceActions, updateTab } = ws

  // Agent used to be a workspace tab. Move restored/deep-linked Agent tabs
  // into the permanent conversation pane and leave the dock on its launcher.
  useEffect(() => {
    if (activeTab?.active !== 'team.agent') return
    workspaceActions.selectSession(activeTab.agentSessionId ?? null)
    updateTab(activeTab.id, (current) => ({
      ...current,
      active: 'team.new-tab',
      agentSessionId: null,
      filter: '',
      count: 0,
    }))
  }, [activeTab, workspaceActions, updateTab])
}
