import { Lock } from 'lucide-react'
import { useCallback, useEffect, useMemo } from 'react'

import { api } from '../api'
import { Age } from '../components/Age'
import { Table } from '../components/Table'
import { useSlowPollTick } from '../hooks/useSlowPoll'
import { withResourceListCache, resourceListCacheKey } from '../lib/resourceListCache'
import { useLinkOnlyRowMenu, useWorkspaceRowLink } from '../lib/workspaceRowLink'

import { useResourceList } from './useResourceList'

import type { Column } from '../components/Table'
import type { GithubInstallation, GithubRepository } from '../types'

type Props = {
  teamId: string
  installation: GithubInstallation
  filter: string
  refreshKey: number
  onCount: (n: number) => void
  onSelectRepo: (repo: GithubRepository) => void
  onLoading?: (loading: boolean) => void
}

export function GithubRepoListView({
  teamId,
  installation,
  filter,
  refreshKey,
  onCount,
  onSelectRepo,
  onLoading,
}: Props) {
  const pollTick = useSlowPollTick()
  const loader = useMemo(
    () =>
      withResourceListCache(
        resourceListCacheKey('github', [teamId, String(installation.installationId), 'repos']),
        () => api.atlasListGithubRepositories(teamId, installation.installationId),
      ),
    [teamId, installation.installationId],
  )
  const {
    items: repos,
    loading,
    error,
  } = useResourceList(loader, refreshKey, onLoading, { pollTick })

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase()

    if (!f) return repos

    return repos.filter(
      (r) => r.name.toLowerCase().includes(f) || (r.description ?? '').toLowerCase().includes(f),
    )
  }, [repos, filter])

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  const { linkForRow } = useWorkspaceRowLink()
  const getRowLink = useCallback(
    (r: GithubRepository) =>
      linkForRow({
        active: 'team.repository',
        githubNav: {
          view: 'repo',
          installation,
          repo: r,
          tab: 'workflows',
        },
      }),
    [linkForRow, installation],
  )
  const { onRowContextMenu, menu } = useLinkOnlyRowMenu(getRowLink)

  const columns: Column<GithubRepository>[] = [
    {
      key: 'name',
      header: 'Name',
      width: 220,
      sortAccessor: (r) => r.name,
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          {r.private && <Lock className="w-3 h-3 text-tertiary flex-shrink-0" strokeWidth={1.8} />}
          <span className="text-main font-medium">{r.name}</span>
        </span>
      ),
    },
    {
      key: 'description',
      header: 'Description',
      width: 300,
      render: (r) => (
        <span className="text-secondary text-[12px] truncate">
          {r.description ?? <span className="text-tertiary italic">—</span>}
        </span>
      ),
    },
    {
      key: 'defaultBranch',
      header: 'Default branch',
      width: 140,
      render: (r) => <span className="text-tertiary text-[12px]">{r.defaultBranch ?? '—'}</span>,
    },
    {
      key: 'pushedAt',
      header: 'Last push',
      width: 110,
      sortAccessor: (r) => r.pushedAt,
      render: (r) => (
        <span className="text-tertiary">
          <Age value={r.pushedAt ?? null} />
        </span>
      ),
    },
    {
      key: 'visibility',
      header: 'Visibility',
      width: 100,
      render: (r) => (
        <span className="text-tertiary text-[12px]">
          {r.private ? 'Private' : (r.visibility ?? 'Public')}
        </span>
      ),
    },
  ]

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="text-error text-[12.5px] max-w-lg text-center whitespace-pre-wrap">
          {error}
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-tertiary text-[12.5px]">
        Loading…
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {menu}
      <Table<GithubRepository>
        columns={columns}
        rows={filtered}
        rowKey={(r) => String(r.id)}
        storageKey={`github.repos.${String(installation.installationId)}`}
        defaultSort={{ key: 'pushedAt', dir: 'desc' }}
        empty={filter ? `No repositories match "${filter}"` : 'No repositories found'}
        onPrimaryAction={onSelectRepo}
        onRowContextMenu={onRowContextMenu}
      />
    </div>
  )
}
