import { Plus, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { api, parseAtlasError } from '../api'

import { ChangeDetail } from './mongo/ChangeDetail'
import { CenteredLoader, StatusBadge } from './mongo/ChangesCommon'
import { CreateChangeDialog } from './mongo/CreateChangeDialog'
import { useResetOnKey } from './useResetOnKey'

import type { DatabaseChangeRequest, DatabaseConnection, TeamMember } from '../types'

type Props = {
  teamId: string
  currentUserId: string
  connection: DatabaseConnection
  members: TeamMember[]
  onOpenPlanInChat?: (planId: string) => void
}

export function MongoDatabaseChanges({
  teamId,
  currentUserId,
  connection,
  members,
  onOpenPlanInChat,
}: Props) {
  const [changes, setChanges] = useState<DatabaseChangeRequest[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api
      .atlasListDatabaseChangeRequests(teamId, connection.id)
      .then((value) => {
        setChanges(value)
        setSelectedId((current) =>
          current && value.some((item) => item.id === current) ? current : (value[0]?.id ?? null),
        )
      })
      .catch((cause: unknown) => {
        setError(parseAtlasError(cause).message)
        setChanges([])
      })
  }, [connection.id, teamId])

  // `load` is kicked from the effect below, so the error reset it used to do
  // lives here instead; the retry button does it inline.
  useResetOnKey(`${teamId}|${connection.id}`, () => setError(null))

  useEffect(() => {
    load()
  }, [load])
  const hasActivePlanChanges = useMemo(
    () =>
      changes?.some(
        (change) =>
          change.planId && ['pending_approval', 'approved', 'executing'].includes(change.status),
      ) === true,
    [changes],
  )

  useEffect(() => {
    if (!hasActivePlanChanges) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const refreshActivePlans = async () => {
      try {
        const value = await api.atlasListDatabaseChangeRequests(teamId, connection.id)

        if (cancelled) return
        setChanges(value)
        setSelectedId((current) =>
          current && value.some((item) => item.id === current) ? current : (value[0]?.id ?? null),
        )
      } catch {
        // The foreground refresh button owns visible errors. A transient poll
        // must not erase the last usable projection or stop future retries.
      }
      if (!cancelled)
        timer = setTimeout(() => {
          void refreshActivePlans()
        }, 3_000)
    }

    timer = setTimeout(() => {
      void refreshActivePlans()
    }, 3_000)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [hasActivePlanChanges, connection.id, teamId])
  const selected = changes?.find((item) => item.id === selectedId) ?? null
  const memberById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members])
  const memberName = (id: string) => memberById.get(id)?.name || memberById.get(id)?.username || id

  function replace(next: DatabaseChangeRequest) {
    setChanges((current) =>
      current ? [next, ...current.filter((item) => item.id !== next.id)] : [next],
    )
    setSelectedId(next.id)
  }

  async function decide(action: 'submit' | 'approve' | 'reject' | 'cancel') {
    if (!selected) return
    const comment =
      action === 'approve' || action === 'reject'
        ? (window.prompt(`${action === 'approve' ? 'Approval' : 'Rejection'} comment (optional)`) ??
          null)
        : null

    if (action === 'reject' && comment === null) return
    setBusyAction(action)
    setError(null)
    try {
      replace(
        await api.atlasDecideDatabaseChangeRequest(
          teamId,
          connection.id,
          selected.id,
          action,
          comment,
        ),
      )
    } catch (cause) {
      setError(parseAtlasError(cause).message)
    } finally {
      setBusyAction(null)
    }
  }

  async function execute() {
    if (!selected) return
    if (
      !confirm(
        `Execute approved ${selected.operation} on ${selected.database}.${selected.collection}? This will mutate the database using the stored credential.`,
      )
    )
      return
    setBusyAction('execute')
    setError(null)
    try {
      replace(
        await api.atlasExecuteDatabaseChangeRequest(
          teamId,
          connection.id,
          selected.id,
          crypto.randomUUID(),
        ),
      )
    } catch (cause) {
      setError(parseAtlasError(cause).message)
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zGray-800 bg-zGray-900/20">
      <div className="flex items-center justify-between border-b border-zGray-800 px-4 py-3">
        <div>
          <div className="text-[13px] font-medium text-main">MongoDB changes</div>
          <div className="mt-0.5 text-[10.5px] text-tertiary">
            Team approval and authorized execution are separate actions.
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setError(null)
              load()
            }}
            className="rounded-md border border-zGray-800 p-1.5 text-tertiary hover:text-main"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 rounded-md bg-zViolet-500 px-2.5 py-1.5 text-[11.5px] text-white hover:bg-zViolet-400"
          >
            <Plus className="h-3.5 w-3.5" />
            New request
          </button>
        </div>
      </div>
      {error && (
        <div className="m-3 rounded-md border border-error/30 bg-error/5 px-3 py-2 text-[11.5px] text-error">
          {error}
        </div>
      )}
      <div className="grid min-h-[520px] grid-cols-[280px_minmax(0,1fr)]">
        <div className="border-r border-zGray-800">
          {changes === null ? (
            <CenteredLoader />
          ) : changes.length === 0 ? (
            <div className="px-5 py-12 text-center text-[11.5px] text-tertiary">
              No change requests yet.
            </div>
          ) : (
            changes.map((change) => (
              <button
                key={change.id}
                onPointerDown={(e) => {
                  if (e.button !== 0) return
                  setSelectedId(change.id)
                }}
                onClick={(e) => {
                  if (e.detail !== 0) return
                  setSelectedId(change.id)
                }}
                className={`block w-full border-b border-zGray-800 px-3 py-3 text-left ${selectedId === change.id ? 'bg-zViolet-500/10' : 'hover:bg-zGray-800/30'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[12px] font-medium text-main">{change.title}</span>
                  <StatusBadge status={change.status} />
                </div>
                <div className="mt-1 truncate font-mono text-[10.5px] text-tertiary">
                  {change.operation} · {change.database}.{change.collection}
                </div>
                <div className="mt-1 text-[10px] text-tertiary">
                  {change.currentApprovals}/{change.requiredApprovals} approvals ·{' '}
                  {new Date(change.updatedAt).toLocaleString()}
                </div>
              </button>
            ))
          )}
        </div>
        <div className="min-w-0 p-4">
          {selected ? (
            <ChangeDetail
              change={selected}
              currentUserId={currentUserId}
              memberName={memberName}
              busyAction={busyAction}
              onDecide={(action) => void decide(action)}
              onExecute={() => void execute()}
              onOpenPlanInChat={onOpenPlanInChat}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-[12px] text-tertiary">
              Select a request or create a new one.
            </div>
          )}
        </div>
      </div>
      <CreateChangeDialog
        open={createOpen}
        teamId={teamId}
        currentUserId={currentUserId}
        connection={connection}
        members={members}
        onClose={() => setCreateOpen(false)}
        onCreated={(change) => {
          setCreateOpen(false)
          replace(change)
        }}
      />
    </div>
  )
}
