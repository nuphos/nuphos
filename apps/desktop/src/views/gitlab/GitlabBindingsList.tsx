import { faPlus } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { CheckCircle2, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../../api'
import { Age } from '../../components/Age'
import { CloudLogo } from '../../components/CloudLogo'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Table } from '../../components/Table'
import { useResetOnKey } from '../useResetOnKey'

import type { Column } from '../../components/Table'
import type { GitlabBinding } from '../../types'

function hostLabel(hostUrl: string): string {
  try {
    return new URL(hostUrl).hostname
  } catch {
    return hostUrl
  }
}

export function BindingsList({
  teamId,
  filter,
  refreshKey,
  onCount,
  onConnectGitlab,
  onSelect,
}: {
  teamId: string
  filter: string
  refreshKey: number
  onCount: (n: number) => void
  onConnectGitlab: () => void
  onSelect: (b: GitlabBinding) => void
}) {
  const [bindings, setBindings] = useState<GitlabBinding[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unbindTarget, setUnbindTarget] = useState<GitlabBinding | null>(null)
  const reqRef = useRef(0)

  const reload = useCallback(() => {
    const req = ++reqRef.current

    api
      .atlasListGitlabBindings(teamId)
      .then((rows) => {
        if (req !== reqRef.current) return
        setBindings(rows)
      })
      .catch((e: unknown) => {
        if (req !== reqRef.current) return
        setError(String(e instanceof Error ? e.message : e))
      })
  }, [teamId])

  useResetOnKey(`${teamId}|${String(refreshKey)}`, () => {
    setBindings(null)
    setError(null)
  })

  useEffect(() => {
    reload()
  }, [reload, refreshKey])

  const filtered = useMemo(() => {
    const list = bindings ?? []
    const f = filter.trim().toLowerCase()

    if (!f) return list

    return list.filter(
      (b) => b.username.toLowerCase().includes(f) || hostLabel(b.hostUrl).toLowerCase().includes(f),
    )
  }, [bindings, filter])

  useEffect(() => {
    onCount(filtered.length)
  }, [filtered.length, onCount])

  const columns: Column<GitlabBinding>[] = [
    {
      key: 'account',
      header: 'Account',
      width: 220,
      sortAccessor: (b) => b.username,
      render: (b) => (
        <span className="inline-flex items-center gap-1.5">
          <CloudLogo provider="gitlab" size={14} />
          <span className="text-main">@{b.username}</span>
          {b.displayName && <span className="text-tertiary text-[11px]">({b.displayName})</span>}
        </span>
      ),
    },
    {
      key: 'host',
      header: 'Host',
      width: 220,
      sortAccessor: (b) => b.hostUrl,
      render: (b) => (
        <span className="text-tertiary text-[12px] font-mono">{hostLabel(b.hostUrl)}</span>
      ),
    },
    {
      key: 'app',
      header: 'OAuth app',
      width: 140,
      render: (b) => (
        <span className="text-tertiary text-[11.5px]">
          {b.isDefaultClient ? 'Zeabur default' : 'Custom'}
        </span>
      ),
    },
    {
      key: 'age',
      header: 'Age',
      width: 100,
      sortAccessor: (b) => b.createdAt ?? '',
      render: (b) => (
        <span className="text-tertiary">
          <Age value={b.createdAt ?? null} />
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
      render: (b) => (
        <button
          type="button"
          aria-label={`Disconnect ${b.username}`}
          onClick={(e) => {
            e.stopPropagation()
            setUnbindTarget(b)
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
  if (bindings === null) {
    return (
      <div className="flex-1 flex items-center justify-center text-tertiary text-[12.5px]">
        Loading…
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {bindings.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-tertiary text-[12.5px]">
          <div>No GitLab accounts connected to this team yet.</div>
          <button
            onClick={onConnectGitlab}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zGray-800 hover:bg-zGray-700 text-main text-[12.5px]"
          >
            <FontAwesomeIcon icon={faPlus} className="w-3.5 h-3.5" />
            Connect your first GitLab account
          </button>
        </div>
      ) : (
        <Table<GitlabBinding>
          columns={columns}
          rows={filtered}
          rowKey={(b) => b.id}
          storageKey="gitlab.bindings"
          empty={`No accounts match "${filter}"`}
          onPrimaryAction={onSelect}
        />
      )}
      {unbindTarget && (
        <ConfirmDialog
          open
          title="Disconnect GitLab account"
          description={`Atlas will lose access to @${unbindTarget.username} on ${hostLabel(unbindTarget.hostUrl)}. The OAuth grant remains on the GitLab side — revoke it there separately to fully invalidate the tokens.`}
          confirmLabel="Disconnect"
          destructive
          onClose={() => setUnbindTarget(null)}
          onConfirm={async () => {
            await api.atlasUnbindGitlab(teamId, unbindTarget.id)
            reload()
          }}
        />
      )}
    </div>
  )
}
