import { useEffect, useMemo } from 'react'

import { Avatar } from '../../components/Avatar'
import { Button } from '../../components/ui/button'

import { ColorDot, LinearPageMessage, Timestamp } from './linearParts'
import { LinearReconnectPrompt } from './LinearReconnect'
import { useLinearTeamIssues } from './useLinearTeamIssues'

import type { LinearIssueRow, LinearTeamIssuesPage } from '../../types'

type Props = {
  teamId: string
  bindingId: string
  linearTeamId: string
  filter: string
  refreshKey: number
  onCount: (count: number) => void
  onLoaded: (team: LinearTeamIssuesPage['team']) => void
  onOpenIssue: (issue: LinearIssueRow, team: LinearTeamIssuesPage['team']) => void
}

function matches(issue: LinearIssueRow, needle: string): boolean {
  return [issue.identifier, issue.title, issue.state.name, issue.assignee?.name ?? ''].some((v) =>
    v.toLowerCase().includes(needle),
  )
}

function IssueRow({ issue, onOpen }: { issue: LinearIssueRow; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-[12.5px] hover:bg-zGray-800/50"
      >
        <span className="inline-flex" title={issue.state.name}>
          <ColorDot color={issue.state.color} />
        </span>
        <span className="w-[72px] shrink-0 truncate tabular-nums text-tertiary">
          {issue.identifier}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-main">{issue.title}</span>
        {issue.priority > 0 && (
          <span className="hidden shrink-0 text-tertiary @xl:inline">{issue.priorityLabel}</span>
        )}
        <span className="hidden w-16 shrink-0 text-right @lg:inline">
          <Timestamp value={issue.updatedAt} />
        </span>
        <span
          className="flex w-5 shrink-0 justify-end"
          title={issue.assignee?.name ?? 'Unassigned'}
        >
          {issue.assignee && (
            <Avatar
              src={issue.assignee.avatarUrl}
              name={issue.assignee.name}
              size={18}
              className="rounded-full"
            />
          )}
        </span>
      </button>
    </li>
  )
}

export function LinearTeamIssuesView({
  teamId,
  bindingId,
  linearTeamId,
  filter,
  refreshKey,
  onCount,
  onLoaded,
  onOpenIssue,
}: Props) {
  const { state, loadMore, reload } = useLinearTeamIssues(
    teamId,
    bindingId,
    linearTeamId,
    refreshKey,
  )
  const page = state.kind === 'loaded' ? state.page : null
  const issues = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    const all = page?.issues ?? []

    return needle ? all.filter((issue) => matches(issue, needle)) : all
  }, [page, filter])

  useEffect(() => onCount(issues.length), [issues.length, onCount])
  useEffect(() => {
    if (page) onLoaded(page.team)
  }, [onLoaded, page])

  if (state.kind === 'loading') return <LinearPageMessage>Loading…</LinearPageMessage>
  if (state.kind === 'not-found') return <LinearPageMessage>Team not found.</LinearPageMessage>
  if (state.kind === 'no-access') {
    return (
      <LinearPageMessage>You don&apos;t have access to this Linear workspace.</LinearPageMessage>
    )
  }
  if (state.kind === 'reconnect') {
    return (
      <LinearPageMessage>
        <LinearReconnectPrompt teamId={teamId} onReconnected={reload} />
      </LinearPageMessage>
    )
  }
  if (state.kind === 'error') {
    return <LinearPageMessage>Issues could not be loaded.</LinearPageMessage>
  }
  const { team, nextCursor } = state.page

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-zGray-800/70">
        <div className="mx-auto max-w-3xl px-4 py-3 @xl:px-6">
          <h1 className="truncate text-[15px] font-semibold text-main">{team.name}</h1>
          <div className="text-[12px] text-tertiary">Open issues · recently updated first</div>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto max-w-3xl px-2 py-2 @xl:px-4 @xl:py-3">
          {issues.length === 0 ? (
            <div className="px-2 py-6 text-center text-[12.5px] text-tertiary">
              {filter.trim() ? `No loaded issues match “${filter}”.` : 'No open issues.'}
            </div>
          ) : (
            <ul>
              {issues.map((issue) => (
                <IssueRow
                  key={issue.identifier}
                  issue={issue}
                  onOpen={() => onOpenIssue(issue, team)}
                />
              ))}
            </ul>
          )}
          {nextCursor && (
            <div className="flex justify-center py-3">
              <Button variant="ghost" size="sm" disabled={state.loadingMore} onClick={loadMore}>
                {state.loadingMore ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
