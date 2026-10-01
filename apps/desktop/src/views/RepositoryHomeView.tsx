import { CheckCircle2, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../api'
import { Age } from '../components/Age'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { GithubMark } from '../components/GithubMark'
import { Table } from '../components/Table'
import { useSilentTick } from '../hooks/useSilentRefresh'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'
import { useLinkOnlyRowMenu, useWorkspaceRowLink } from '../lib/workspaceRowLink'

import { useResetOnKey } from './useResetOnKey'

import type { Column } from '../components/Table'
import type { GithubInstallation } from '../types'

type Props = {
  teamId: string
  filter: string
  refreshKey: number
  onCount: (n: number) => void
  onConnectGithub: () => void
  onSelectInstallation?: (installation: GithubInstallation) => void
}

export function RepositoryHomeView({
  teamId,
  filter,
  refreshKey,
  onCount,
  onConnectGithub,
  onSelectInstallation,
}: Props) {
  const [installations, setInstallations] = useState<GithubInstallation[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unbindTarget, setUnbindTarget] = useState<GithubInstallation | null>(null)
  // Guards against an in-flight list call clobbering newer state when the user
  // switches teams or rebinds quickly.
  const reqRef = useRef(0)

  const reload = useCallback(() => {
    const req = ++reqRef.current

    api
      .atlasListGithubInstallations(teamId)
      .then((rows) => {
        if (req !== reqRef.current) return
        setInstallations(rows)
        setError(null)
      })
      .catch((e: unknown) => {
        if (req !== reqRef.current) return
        setError(String(e instanceof Error ? e.message : e))
      })
  }, [teamId])

  useResetOnKey(`${teamId}|${String(refreshKey)}`, () => {
    setInstallations(null)
    setError(null)
  })

  useEffect(() => {
    reload()
  }, [reload, refreshKey])
  const { pollTick } = useWorkspaceTab()

  useSilentTick(reload, pollTick)

  const filtered = useMemo(() => {
    const list = installations ?? []
    const f = filter.trim().toLowerCase()

    if (!f) return list

    return list.filter((x) => x.accountLogin.toLowerCase().includes(f))
  }, [installations, filter])

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  const { linkForRow } = useWorkspaceRowLink()
  const getRowLink = useCallback(
    (x: GithubInstallation) =>
      linkForRow({
        active: 'team.repository',
        githubNav: { view: 'repos', installation: x },
      }),
    [linkForRow],
  )
  const { onRowContextMenu, menu } = useLinkOnlyRowMenu(getRowLink)

  const columns: Column<GithubInstallation>[] = [
    {
      key: 'account',
      header: 'Account',
      width: 220,
      sortAccessor: (x) => x.accountLogin,
      render: (x) => (
        <span className="inline-flex items-center gap-1.5">
          <GithubMark size={14} className="text-secondary" />
          <span className="text-main">{x.accountLogin}</span>
        </span>
      ),
    },
    {
      key: 'kind',
      header: 'Kind',
      width: 120,
      render: (x) => <span className="text-secondary">{x.accountType}</span>,
    },
    {
      key: 'scope',
      header: 'Scope',
      width: 200,
      render: (x) => (
        <span className="text-tertiary text-[12px]">
          {x.targetType === 'all' ? 'All repositories' : 'Selected repositories'}
        </span>
      ),
    },
    {
      key: 'age',
      header: 'Age',
      width: 100,
      sortAccessor: (x) => x.createdAt ?? '',
      render: (x) => (
        <span className="text-tertiary">
          <Age value={x.createdAt ?? null} />
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 140,
      render: () => (
        <span className="inline-flex items-center gap-1.5 text-[#73bf69]">
          <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={1.8} />
          Connected
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: 60,
      render: (x) => (
        <button
          type="button"
          aria-label={`Disconnect ${x.accountLogin}`}
          onClick={(e) => {
            e.stopPropagation()
            setUnbindTarget(x)
          }}
          className="p-1 rounded text-tertiary hover:text-error hover:bg-zGray-800"
          title="Disconnect"
        >
          <Trash2 className="w-3.5 h-3.5" strokeWidth={1.8} />
        </button>
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

  if (installations === null) {
    return (
      <div className="flex-1 flex items-center justify-center text-tertiary text-[12.5px]">
        Loading…
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {installations.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-tertiary text-[12.5px]">
          <div>No GitHub accounts connected to this team yet.</div>
          <button
            onClick={onConnectGithub}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zGray-800 hover:bg-zGray-700 text-main text-[12.5px]"
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={2} />
            Connect your first account
          </button>
        </div>
      ) : (
        <>
          {menu}
          <Table<GithubInstallation>
            columns={columns}
            rows={filtered}
            rowKey={(x) => x.id}
            storageKey="repository.installations"
            empty={`No accounts match "${filter}"`}
            onPrimaryAction={onSelectInstallation}
            onRowContextMenu={onRowContextMenu}
          />
        </>
      )}
      {unbindTarget && (
        <ConfirmDialog
          open
          title="Disconnect GitHub account"
          description={`Nuphos will lose access to ${unbindTarget.accountLogin}. The GitHub App stays installed on GitHub — uninstall it there separately if you want to fully revoke access.`}
          confirmLabel="Disconnect"
          destructive
          onClose={() => setUnbindTarget(null)}
          onConfirm={async () => {
            await api.atlasUnbindGithubInstallation(teamId, unbindTarget.installationId)
            reload()
          }}
        />
      )}
    </div>
  )
}
