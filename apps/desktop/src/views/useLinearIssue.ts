import { useCallback, useEffect, useState } from 'react'

import { api, parseAtlasError } from '../api'
import { toast } from '../components/ui/toast'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'

import { LINEAR_RECONNECT_REQUIRED } from './linear/LinearReconnect'

import type { LinearIssueDetail } from '../types'

// The dock's poll ticks every 5 s; Linear's API is rate-limited per token, so refetch every 30 s.
const LINEAR_POLL_EVERY_TICKS = 6

export type LinearIssueLoadState =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'no-access' }
  | { kind: 'reconnect' }
  | { kind: 'error'; message: string }
  | { kind: 'loaded'; issue: LinearIssueDetail }

export function useLinearIssue(
  teamId: string,
  bindingId: string,
  identifier: string,
  refreshKey: number,
) {
  const { pollTick, isActive } = useWorkspaceTab()
  const [state, setState] = useState<LinearIssueLoadState>({ kind: 'loading' })

  const load = useCallback(
    (background: boolean) =>
      api
        .atlasGetLinearIssue(teamId, bindingId, identifier)
        .then((issue) => setState({ kind: 'loaded', issue }))
        .catch((reason: unknown) => {
          if (background) return
          const { code, message } = parseAtlasError(reason)

          if (code === 'linear_issue_not_found') return setState({ kind: 'not-found' })
          if (code === 'linear_workspace_access_denied') return setState({ kind: 'no-access' })
          if (code === LINEAR_RECONNECT_REQUIRED) return setState({ kind: 'reconnect' })
          setState({ kind: 'error', message })
          toast.apiError('Failed to load Linear issue', reason)
        }),
    [teamId, bindingId, identifier],
  )

  useEffect(() => {
    void load(false)
  }, [load, refreshKey])
  useEffect(() => {
    if (isActive && pollTick > 0 && pollTick % LINEAR_POLL_EVERY_TICKS === 0) void load(true)
  }, [load, isActive, pollTick])

  const reload = useCallback(() => {
    setState({ kind: 'loading' })
    void load(false)
  }, [load])

  return { state, reload }
}
