import { useCallback, useEffect, useState } from 'react'

import { api, parseAtlasError } from '../../api'
import { toast } from '../../components/ui/toast'

import { LINEAR_RECONNECT_REQUIRED } from './LinearReconnect'

import type { LinearTeamSummary, LinearWorkspace } from '../../types'

export type LinearWorkspaceTeams = {
  workspace: LinearWorkspace
  teams: LinearTeamSummary[]
  status: 'ok' | 'no-access' | 'reconnect' | 'error'
}

export type LinearTeamsLoadState =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'loaded'; groups: LinearWorkspaceTeams[] }

async function loadWorkspaceTeams(
  teamId: string,
  workspace: LinearWorkspace,
): Promise<LinearWorkspaceTeams> {
  try {
    const { teams } = await api.atlasListLinearTeams(teamId, workspace.id)

    return { workspace, teams, status: 'ok' }
  } catch (reason) {
    const { code } = parseAtlasError(reason)

    if (code === 'linear_workspace_access_denied') {
      return { workspace, teams: [], status: 'no-access' }
    }
    if (code === LINEAR_RECONNECT_REQUIRED) return { workspace, teams: [], status: 'reconnect' }
    toast.apiError(`Failed to load teams for ${workspace.workspaceName}`, reason)

    return { workspace, teams: [], status: 'error' }
  }
}

export function useLinearTeams(teamId: string, refreshKey: number) {
  const [state, setState] = useState<LinearTeamsLoadState>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const run = { cancelled: false }

    void (async () => {
      try {
        const workspaces = await api.atlasListLinearWorkspaces(teamId)
        const groups = await Promise.all(workspaces.map((w) => loadWorkspaceTeams(teamId, w)))

        if (!run.cancelled) setState({ kind: 'loaded', groups })
      } catch (reason) {
        if (run.cancelled) return
        setState({ kind: 'error' })
        toast.apiError('Failed to load Linear workspaces', reason)
      }
    })()

    return () => {
      run.cancelled = true
    }
  }, [teamId, refreshKey, attempt])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  return { state, reload }
}
