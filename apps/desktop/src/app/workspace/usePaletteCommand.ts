import { useCallback } from 'react'

import { SWITCH_TEAM_PREFIX } from '../../components/session-search/paletteCommands'
import {
  TEAM_SETTINGS_DEFAULT_SECTION,
  USER_SETTINGS_DEFAULT_SECTION,
} from '../../views/settings/settingsNav'

import type { WorkspaceController } from './useWorkspaceController'

/** Runs a ⌘K page or action through the same paths as the sidebar and the app shortcuts. */
export function usePaletteCommand(ws: WorkspaceController) {
  const {
    setSessionSearchOpen,
    onSidebarSelect,
    workspaceActions,
    newTab,
    toggleSidebarCollapsed,
    openSettingsSection,
    setShortcutsHelpOpen,
    switchTeam,
  } = ws

  return useCallback(
    (id: string) => {
      setSessionSearchOpen(false)
      if (id === 'new-chat') workspaceActions.selectSession(null)
      else if (id === 'new-tab') newTab()
      else if (id === 'toggle-sidebar') toggleSidebarCollapsed()
      else if (id === 'open-settings') openSettingsSection(USER_SETTINGS_DEFAULT_SECTION)
      else if (id === 'open-team-settings') openSettingsSection(TEAM_SETTINGS_DEFAULT_SECTION)
      else if (id === 'shortcuts-help') setShortcutsHelpOpen(true)
      else if (id.startsWith(SWITCH_TEAM_PREFIX)) switchTeam(id.slice(SWITCH_TEAM_PREFIX.length))
      else onSidebarSelect(id)
    },
    [
      setSessionSearchOpen,
      onSidebarSelect,
      workspaceActions,
      newTab,
      toggleSidebarCollapsed,
      openSettingsSection,
      setShortcutsHelpOpen,
      switchTeam,
    ],
  )
}
