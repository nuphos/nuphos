import { Lock } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../../api'
import { Age } from '../../components/Age'
import { Table } from '../../components/Table'
import { useResetOnKey } from '../useResetOnKey'

import type { Column } from '../../components/Table'
import type { GitlabBinding, GitlabNamespace, GitlabProject } from '../../types'

export function ProjectsList({
  teamId,
  binding,
  namespace,
  filter,
  refreshKey,
  onCount,
  onSelect,
}: {
  teamId: string
  binding: GitlabBinding
  namespace?: GitlabNamespace
  filter: string
  refreshKey: number
  onCount: (n: number) => void
  onSelect: (p: GitlabProject) => void
}) {
  const [projects, setProjects] = useState<GitlabProject[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reqRef = useRef(0)

  const load = useCallback(() => {
    const req = ++reqRef.current

    api
      .atlasListGitlabProjects(teamId, binding.id, namespace?.fullPath)
      .then((rows) => {
        if (req !== reqRef.current) return
        setProjects(rows)
      })
      .catch((e: unknown) => {
        if (req !== reqRef.current) return
        setError(e instanceof Error && e.message ? e.message : 'Failed to load projects.')
      })
  }, [teamId, binding.id, namespace?.fullPath])

  useResetOnKey(
    `${teamId}|${binding.id}|${namespace?.fullPath ?? ''}|${String(refreshKey)}`,
    () => {
      setProjects(null)
      setError(null)
    },
  )

  useEffect(() => {
    load()
  }, [load, refreshKey])

  const filtered = useMemo(() => {
    const list = projects ?? []
    const f = filter.trim().toLowerCase()

    if (!f) return list

    return list.filter(
      (p) =>
        p.name.toLowerCase().includes(f) ||
        p.pathWithNamespace.toLowerCase().includes(f) ||
        (p.description ?? '').toLowerCase().includes(f),
    )
  }, [projects, filter])

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  const columns: Column<GitlabProject>[] = [
    {
      key: 'name',
      header: 'Project',
      width: 280,
      sortAccessor: (p) => p.pathWithNamespace,
      render: (p) => (
        <span className="inline-flex items-center gap-1.5">
          {p.visibility === 'private' && (
            <Lock className="w-3 h-3 text-tertiary flex-shrink-0" strokeWidth={1.8} />
          )}
          <span className="text-main font-medium">{p.pathWithNamespace}</span>
        </span>
      ),
    },
    {
      key: 'description',
      header: 'Description',
      width: 300,
      render: (p) => (
        <span className="text-secondary text-[12px] truncate">
          {p.description ?? <span className="text-tertiary italic">—</span>}
        </span>
      ),
    },
    {
      key: 'defaultBranch',
      header: 'Default branch',
      width: 140,
      render: (p) => <span className="text-tertiary text-[12px]">{p.defaultBranch ?? '—'}</span>,
    },
    {
      key: 'lastActivityAt',
      header: 'Last activity',
      width: 110,
      sortAccessor: (p) => p.lastActivityAt ?? '',
      render: (p) => (
        <span className="text-tertiary">
          <Age value={p.lastActivityAt ?? null} />
        </span>
      ),
    },
    {
      key: 'visibility',
      header: 'Visibility',
      width: 100,
      render: (p) => <span className="text-tertiary text-[12px] capitalize">{p.visibility}</span>,
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
  if (projects === null) {
    return (
      <div className="flex-1 flex items-center justify-center text-tertiary text-[12.5px]">
        Loading…
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <Table<GitlabProject>
        columns={columns}
        rows={filtered}
        rowKey={(p) => String(p.id)}
        storageKey={`gitlab.projects.${binding.id}`}
        defaultSort={{ key: 'lastActivityAt', dir: 'desc' }}
        empty={filter ? `No projects match "${filter}"` : 'No projects found'}
        onPrimaryAction={onSelect}
      />
    </div>
  )
}
