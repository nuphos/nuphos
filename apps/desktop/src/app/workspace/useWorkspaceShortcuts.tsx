import { useCallback, useEffect } from 'react'

import { restorePersistedTab } from '../../app/workspacePersistence'
import {
  TEAM_SETTINGS_DEFAULT_SECTION,
  USER_SETTINGS_DEFAULT_SECTION,
} from '../../views/settings/settingsNav'

import { useWorkspacePane } from './WorkspacePaneContext'

import type { WorkspaceShellStateResult } from './useWorkspaceShellState'
import type { WorkspaceTabSyncResult } from './useWorkspaceTabSync'

type Args = WorkspaceShellStateResult & WorkspaceTabSyncResult

/**
 * App-level keyboard shortcuts beyond tab open/close (which live in
 * useWorkspaceTabLifecycle): ⌘, user settings, ⇧⌘, team settings, ⌘B sidebar, ⌘/ shortcut help,
 * ⌘1-9 tab switching and ⌘⇧T reopen-closed-tab. All of them arrive as
 * `app:shortcut` IPC actions captured by the main process's
 * before-input-event handler (electron/main/windows.ts), so they keep
 * working while an xterm terminal or Monaco editor has focus.
 */
export function useWorkspaceShortcuts(a: Args) {
  const paneActive = useWorkspacePane()?.active ?? true
  const {
    workspaceActions,
    settingsOpen,
    setSettingsOpen,
    setSettingsInitialSection,
    shortcutsHelpOpen,
    setShortcutsHelpOpen,
    toggleSidebarCollapsed,
    createOrJoinOpen,
    onboardingActive,
    closedTabSnapshotsRef,
  } = a

  const reopenLastClosedTab = useCallback(() => {
    const snapshot = closedTabSnapshotsRef.current.pop()

    if (!snapshot) return
    // Same restore path duplicateTab uses: fresh id, runtime state (SSH PTY,
    // loading flags) reset, navigation history carried over.
    const tab = restorePersistedTab(snapshot)

    if (tab) workspaceActions.openTab(tab)
  }, [closedTabSnapshotsRef, workspaceActions])

  useEffect(() => {
    if (!paneActive || typeof window.api.onAppShortcut !== 'function') return

    return window.api.onAppShortcut((action) => {
      if (action === 'toggle-sidebar') {
        toggleSidebarCollapsed()

        return
      }
      if (action === 'reopen-closed-tab') {
        reopenLastClosedTab()

        return
      }
      const tabMatch = /^select-tab-([1-9])$/.exec(action)

      if (tabMatch) {
        const n = Number(tabMatch[1])

        // Browser convention: ⌘9 is "last tab", not the literal ninth.
        workspaceActions.selectTabAt(n === 9 ? 'last' : n - 1)

        return
      }
      // Overlay-opening shortcuts are suppressed while a takeover owns the
      // window: the onboarding branch returns before SettingsPage renders, and
      // CreateOrJoinTeamView stacks above it in DOM order.
      if (onboardingActive || createOrJoinOpen) return
      if (action === 'new-chat') {
        setSettingsOpen(false)
        workspaceActions.selectSession(null)

        return
      }
      if (action === 'open-settings' || action === 'open-team-settings') {
        if (settingsOpen) {
          setSettingsOpen(false)

          return
        }
        setSettingsInitialSection(
          action === 'open-settings'
            ? USER_SETTINGS_DEFAULT_SECTION
            : TEAM_SETTINGS_DEFAULT_SECTION,
        )
        setSettingsOpen(true)
      } else if (action === 'shortcuts-help') {
        setShortcutsHelpOpen(!shortcutsHelpOpen)
      }
    })
  }, [
    paneActive,
    workspaceActions,
    settingsOpen,
    shortcutsHelpOpen,
    onboardingActive,
    createOrJoinOpen,
    toggleSidebarCollapsed,
    reopenLastClosedTab,
    setSettingsOpen,
    setSettingsInitialSection,
    setShortcutsHelpOpen,
  ])

  return { reopenLastClosedTab }
}

export type WorkspaceShortcutsResult = ReturnType<typeof useWorkspaceShortcuts>
