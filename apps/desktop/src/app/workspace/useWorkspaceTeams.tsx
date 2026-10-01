import { useCallback, useEffect } from 'react'

import { api, isNetworkError, isSessionRejected } from '../../api'
import { readLocalStorage, writeLocalStorage } from '../../app/localStorage'
import { restoreNavigation } from '../../app/workspaceTabFactory'
import { LAST_TEAM_STORAGE_KEY } from '../../app/workspaceTabState'
import { toast } from '../../components/ui/toast'
import { stepNavigation } from '../../lib/navHistory'

import { selectScope } from './store/workspaceState'

import type { WorkspaceActiveTabResult } from './useWorkspaceActiveTab'
import type { WorkspaceShellStateResult } from './useWorkspaceShellState'
import type { WorkspaceTabSyncResult } from './useWorkspaceTabSync'
import type { WorkspaceProps } from './workspaceProps'
import type { AtlasTeam } from '../../types'

type Args = WorkspaceProps &
  WorkspaceShellStateResult &
  WorkspaceActiveTabResult &
  WorkspaceTabSyncResult

export function useWorkspaceTeams(a: Args) {
  const {
    setTeams,
    workspaceStore,
    workspaceActions,
    setError,
    setTeamsLoading,
    setBackendUnreachable,
    backendRetryTimerRef,
    loadTeamsTokenRef,
    setTeamsLoaded,
    updateActiveTab,
    onLogout,
  } = a

  const navigateHistory = useCallback(
    (direction: -1 | 1) => {
      updateActiveTab(
        (tab) => {
          const step = stepNavigation(tab, direction)

          if (!step) return tab

          return restoreNavigation(tab, step.snapshot, step.index)
        },
        { history: 'restore' },
      )
    },
    [updateActiveTab],
  )

  // Restored tabs whose team this account no longer belongs to are dropped
  // from every session; the workspace's team falls back to the last one used.
  const bootstrapTeams = useCallback(
    (nextTeams: AtlasTeam[]) => {
      setTeams(nextTeams)
      setTeamsLoaded(true)
      const storedTeamId = readLocalStorage(LAST_TEAM_STORAGE_KEY)
      const preferred = nextTeams.find((team) => team.id === storedTeamId) ?? nextTeams.at(0)

      workspaceActions.retainTeams(
        nextTeams.map((team) => team.id),
        preferred?.id ?? null,
      )
      const teamId = selectScope(workspaceStore.getState())?.teamId

      // With zero teams, leave `error`/`onboardingActive` alone: a pending
      // invitation may still arrive, and the auto-entry effect makes that call
      // once both lists have resolved.
      if (!teamId) return
      writeLocalStorage(LAST_TEAM_STORAGE_KEY, teamId)
      setError(null)
    },
    [setTeams, setTeamsLoaded, setError, workspaceActions, workspaceStore],
  )

  const loadTeams = useCallback(async () => {
    // The retry below re-enters through this local function: `loadTeams` is
    // not yet initialized inside its own `useCallback`.
    const run = async (): Promise<void> => {
      const token = ++loadTeamsTokenRef.current

      if (backendRetryTimerRef.current != null) {
        window.clearTimeout(backendRetryTimerRef.current)
        backendRetryTimerRef.current = null
      }
      setError(null)
      setTeamsLoading(true)
      try {
        const ts = await api.atlasListTeams()

        if (token !== loadTeamsTokenRef.current) return // superseded / unmounted
        setBackendUnreachable(false)
        bootstrapTeams(ts)
      } catch (e) {
        if (token !== loadTeamsTokenRef.current) return // don't touch state or schedule a retry
        // A transient connectivity failure on first load isn't a dead end — the
        // backend may be momentarily unreachable (a network blip, or in local dev
        // still booting). Poll until it's back instead of stranding the user on a
        // manual Retry button; genuine app errors still surface immediately.
        if (isSessionRejected(e)) {
          void onLogout()
        } else if (isNetworkError(e)) {
          setBackendUnreachable(true)
          backendRetryTimerRef.current = window.setTimeout(() => void run(), 1500)
        } else {
          setBackendUnreachable(false)
          // Error detail goes through the global toast (never inline); the gate
          // keeps only a generic Retry affordance via `error`.
          toast.apiError('Could not load teams', e)
          setError('Could not load teams.')
        }
      } finally {
        if (token === loadTeamsTokenRef.current) setTeamsLoading(false)
      }
    }

    await run()
  }, [
    bootstrapTeams,
    backendRetryTimerRef,
    loadTeamsTokenRef,
    onLogout,
    setBackendUnreachable,
    setError,
    setTeamsLoading,
  ])

  useEffect(() => {
    const tokens = loadTeamsTokenRef
    const retryTimer = backendRetryTimerRef

    void loadTeams()

    return () => {
      // Invalidate any in-flight load so its late resolve/reject is ignored.
      tokens.current++
      if (retryTimer.current != null) window.clearTimeout(retryTimer.current)
    }
  }, [loadTeams, loadTeamsTokenRef, backendRetryTimerRef])

  return {
    navigateHistory,
    bootstrapTeams,
    loadTeams,
  }
}

export type WorkspaceTeamsResult = ReturnType<typeof useWorkspaceTeams>
