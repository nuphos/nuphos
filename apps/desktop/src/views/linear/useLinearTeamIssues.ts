import { useCallback, useEffect, useRef, useState } from 'react'

import { api, parseAtlasError } from '../../api'
import { toast } from '../../components/ui/toast'

import { LINEAR_RECONNECT_REQUIRED } from './LinearReconnect'

import type { LinearTeamIssuesPage } from '../../types'

export type LinearTeamIssuesLoadState =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'no-access' }
  | { kind: 'reconnect' }
  | { kind: 'error' }
  | { kind: 'loaded'; page: LinearTeamIssuesPage; loadingMore: boolean }

export function useLinearTeamIssues(
  teamId: string,
  bindingId: string,
  linearTeamId: string,
  refreshKey: number,
) {
  const [state, setState] = useState<LinearTeamIssuesLoadState>({ kind: 'loading' })
  const generation = useRef(0)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const current = ++generation.current

    api
      .atlasListLinearTeamIssues(teamId, bindingId, linearTeamId)
      .then((page) => {
        if (current === generation.current) setState({ kind: 'loaded', page, loadingMore: false })
      })
      .catch((reason: unknown) => {
        if (current !== generation.current) return
        const { code } = parseAtlasError(reason)

        if (code === 'linear_team_not_found') return setState({ kind: 'not-found' })
        if (code === 'linear_workspace_access_denied') return setState({ kind: 'no-access' })
        if (code === LINEAR_RECONNECT_REQUIRED) return setState({ kind: 'reconnect' })
        setState({ kind: 'error' })
        toast.apiError('Failed to load Linear issues', reason)
      })
  }, [teamId, bindingId, linearTeamId, refreshKey, attempt])

  const loadMore = useCallback(() => {
    if (state.kind !== 'loaded' || state.loadingMore || !state.page.nextCursor) return
    const current = generation.current
    const { page } = state

    setState({ kind: 'loaded', page, loadingMore: true })
    api
      .atlasListLinearTeamIssues(teamId, bindingId, linearTeamId, page.nextCursor ?? undefined)
      .then((next) => {
        if (current !== generation.current) return
        setState({
          kind: 'loaded',
          page: { ...next, issues: [...page.issues, ...next.issues] },
          loadingMore: false,
        })
      })
      .catch((reason: unknown) => {
        if (current !== generation.current) return
        setState({ kind: 'loaded', page, loadingMore: false })
        toast.apiError('Failed to load more Linear issues', reason)
      })
  }, [state, teamId, bindingId, linearTeamId])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  return { state, loadMore, reload }
}
