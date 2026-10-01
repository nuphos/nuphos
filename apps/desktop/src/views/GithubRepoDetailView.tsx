import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../api'
import { Table } from '../components/Table'
import { useSlowPoll } from '../hooks/useSlowPoll'
import { useLinkOnlyRowMenu, useWorkspaceRowLink } from '../lib/workspaceRowLink'

import { prColumns, runColumns } from './github-repo/githubRepoColumns'
import { matchesPullFilter, matchesRunFilter } from './github-repo/repoFilters'
import { useResetOnKey } from './useResetOnKey'

import type { GithubInstallation, GithubPR, GithubRepository, GithubWorkflowRun } from '../types'

export type GithubRepoTab = 'prs' | 'actions'
export type GithubPRState = 'open' | 'closed' | 'all'

type Props = {
  teamId: string
  installation: GithubInstallation
  repo: GithubRepository
  filter: string
  refreshKey: number
  onCount: (n: number) => void
  tab: GithubRepoTab
  prState: GithubPRState
  onSelectPull: (pr: GithubPR) => void
}

export function GithubRepoDetailView({
  teamId,
  installation,
  repo,
  filter,
  refreshKey,
  onCount,
  tab,
  prState,
  onSelectPull,
}: Props) {
  const [prs, setPrs] = useState<GithubPR[] | null>(null)
  const [prsError, setPrsError] = useState<string | null>(null)
  const prsReqRef = useRef(0)

  const [runs, setRuns] = useState<GithubWorkflowRun[] | null>(null)
  const [runsError, setRunsError] = useState<string | null>(null)
  const runsReqRef = useRef(0)

  const [owner] = repo.fullName.split('/')

  const loadPrs = useCallback(
    (background = false) => {
      const req = ++prsReqRef.current

      api
        .atlasListGithubPulls(teamId, installation.installationId, owner, repo.name, prState)
        .then((rows) => {
          if (req !== prsReqRef.current) return
          setPrsError(null)
          setPrs(rows)
        })
        .catch((e: unknown) => {
          if (req !== prsReqRef.current || background) return
          setPrsError(String(e instanceof Error ? e.message : e))
        })
    },
    [teamId, installation.installationId, owner, repo.name, prState],
  )

  const loadRuns = useCallback(
    (background = false) => {
      const req = ++runsReqRef.current

      api
        .atlasListGithubActionRuns(teamId, installation.installationId, owner, repo.name, 1)
        .then(({ runs: rows }) => {
          if (req !== runsReqRef.current) return
          setRunsError(null)
          setRuns(rows)
        })
        .catch((e: unknown) => {
          if (req !== runsReqRef.current || background) return
          setRunsError(String(e instanceof Error ? e.message : e))
        })
    },
    [teamId, installation.installationId, owner, repo.name],
  )

  const repoKey = `${teamId}|${String(installation.installationId)}|${owner}|${repo.name}`

  useResetOnKey(`${repoKey}|${prState}|${String(refreshKey)}`, () => {
    setPrs(null)
    setPrsError(null)
  })
  useEffect(() => {
    loadPrs()
  }, [loadPrs, refreshKey])

  useResetOnKey(`${repoKey}|${String(refreshKey)}`, () => {
    setRuns(null)
    setRunsError(null)
  })
  useEffect(() => {
    loadRuns()
  }, [loadRuns, refreshKey])

  useSlowPoll(() => {
    if (prs !== null) loadPrs(true)
    if (runs !== null) loadRuns(true)
  })

  const filteredPrs = useMemo(
    () => (prs ?? []).filter((pr) => matchesPullFilter(pr, filter)),
    [prs, filter],
  )
  const filteredRuns = useMemo(
    () => (runs ?? []).filter((run) => matchesRunFilter(run, filter)),
    [runs, filter],
  )

  useEffect(() => {
    if (tab === 'prs') onCount(filteredPrs.length)
    else onCount(filteredRuns.length)
  }, [tab, filteredPrs.length, filteredRuns.length, onCount])

  const { linkForRow } = useWorkspaceRowLink()
  const [repoOwner, repoName] = repo.fullName.split('/')
  const repoBasePath = `/teams/${encodeURIComponent(teamId)}/repository/installations/${encodeURIComponent(String(installation.installationId))}/repos/${encodeURIComponent(repoOwner ?? '')}/${encodeURIComponent(repoName ?? repo.name)}`
  const getPrLink = useCallback(
    (pr: GithubPR) =>
      linkForRow({
        path: `${repoBasePath}/pull-requests/${encodeURIComponent(String(pr.number))}`,
      }),
    [linkForRow, repoBasePath],
  )
  const { onRowContextMenu: onPrContextMenu, menu: prMenu } = useLinkOnlyRowMenu(getPrLink)

  const getRunLink = useCallback(
    (run: GithubWorkflowRun) =>
      linkForRow({
        path: `${repoBasePath}/workflows/${encodeURIComponent(String(run.id))}`,
      }),
    [linkForRow, repoBasePath],
  )
  const { onRowContextMenu: onRunContextMenu, menu: runMenu } = useLinkOnlyRowMenu(getRunLink)

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {tab === 'prs' && (
        <>
          {prsError ? (
            <div className="flex-1 flex items-center justify-center px-4">
              <div className="text-error text-[12.5px] max-w-lg text-center whitespace-pre-wrap">
                {prsError}
              </div>
            </div>
          ) : prs === null ? (
            <div className="flex-1 flex items-center justify-center text-tertiary text-[12.5px]">
              Loading…
            </div>
          ) : (
            <>
              {prMenu}
              <Table<GithubPR>
                columns={prColumns}
                rows={filteredPrs}
                rowKey={(pr) => String(pr.number)}
                storageKey={`github.prs.${String(installation.installationId)}.${String(repo.id)}`}
                empty={
                  filter
                    ? `No pull requests match "${filter}"`
                    : `No ${prState === 'all' ? '' : prState + ' '}pull requests`
                }
                onPrimaryAction={onSelectPull}
                onRowContextMenu={onPrContextMenu}
              />
            </>
          )}
        </>
      )}

      {tab === 'actions' && (
        <>
          {runsError ? (
            <div className="flex-1 flex items-center justify-center px-4">
              <div className="text-error text-[12.5px] max-w-lg text-center whitespace-pre-wrap">
                {runsError}
              </div>
            </div>
          ) : runs === null ? (
            <div className="flex-1 flex items-center justify-center text-tertiary text-[12.5px]">
              Loading…
            </div>
          ) : (
            <>
              {runMenu}
              <Table<GithubWorkflowRun>
                columns={runColumns}
                rows={filteredRuns}
                rowKey={(r) => String(r.id)}
                storageKey={`github.runs.${String(installation.installationId)}.${String(repo.id)}`}
                empty={filter ? `No workflow runs match "${filter}"` : 'No workflow runs'}
                onPrimaryAction={(r) => window.open(r.htmlUrl, '_blank')}
                onRowContextMenu={onRunContextMenu}
              />
            </>
          )}
        </>
      )}
    </div>
  )
}
