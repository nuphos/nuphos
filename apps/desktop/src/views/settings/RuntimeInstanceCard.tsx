import clsx from 'clsx'
import { ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../api'
import { ClaudeCodeIcon, CodexIcon } from '../../components/agent/panel/icons'
import { QuotaBadge } from '../../components/agent/panel/RuntimeSelector'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { toast } from '../../components/ui/toast'
import { RUNTIME_INSTANCES_CHANGED } from '../../hooks/useRuntimeInstances'

import { RuntimeActionsMenu } from './RuntimeActionsMenu'
import { RuntimeDefaultsSection } from './RuntimeDefaultsSection'
import { RuntimeInstanceForm } from './RuntimeInstanceForm'
import { RuntimeLoginDialog } from './RuntimeLoginDialog'
import { RuntimeMetricsCharts } from './RuntimeMetricsCharts'
import { RuntimeOverview } from './RuntimeOverview'
import { STATUS_DOT, runtimeStatusView } from './runtimePresentation'
import { RuntimeSignIn } from './RuntimeSignIn'
import { RuntimeUpdateNotice } from './RuntimeUpdateNotice'

import type { PolledRuntimeStatus } from './RuntimeOverview'
import type { RuntimeInstance, RuntimeQuota } from '../../types/runtime'

const STATUS_POLL_MS = 10_000
const STARTING_POLL_MS = 2_000

/** One runtime: a compact row that stays informative while collapsed (status,
 *  image) and expands into status, resource usage and defaults. */
export function RuntimeInstanceCard({
  teamId,
  instance,
  quota,
  isAdmin,
  expanded,
  onToggle,
}: {
  teamId: string
  instance: RuntimeInstance
  quota?: RuntimeQuota
  isAdmin: boolean
  expanded: boolean
  onToggle: () => void
}) {
  const [signingIn, setSigningIn] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirmRemoval, setConfirmRemoval] = useState(false)
  const [busy, setBusy] = useState(false)
  const [runtime, setRuntime] = useState<PolledRuntimeStatus | null>(null)
  const [statusError, setStatusError] = useState(false)
  const [updateRevision, setUpdateRevision] = useState(0)
  const enabled = instance.status === 'active'

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    // An agent that is starting is watched closely, so Sign in appears the moment it can.
    const poll = () =>
      void api.atlasGetRuntimeInstanceStatus(teamId, instance.id).then(
        (status) => {
          if (cancelled) return
          setRuntime({ ...status, fetchedAtMs: Date.now() })
          setStatusError(false)
          timer = setTimeout(poll, status.online ? STATUS_POLL_MS : STARTING_POLL_MS)
        },
        () => {
          if (cancelled) return
          setStatusError(true)
          timer = setTimeout(poll, STATUS_POLL_MS)
        },
      )

    poll()

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [teamId, instance.id, enabled, updateRevision])

  const changed = () => window.dispatchEvent(new Event(RUNTIME_INSTANCES_CHANGED))
  const mutate = async (action: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await action()
      changed()
    } catch (error) {
      toast.apiError('Could not update agent', error)
    } finally {
      setBusy(false)
    }
  }
  const Icon = instance.provider === 'codex' ? CodexIcon : ClaudeCodeIcon
  const canEdit = isAdmin && instance.kind !== 'development' && !instance.deletion
  const status = runtimeStatusView(instance, runtime, statusError)
  const kindTag =
    instance.kind === 'external' ? 'External' : instance.kind === 'development' ? 'Local' : null
  const hosted = instance.kind === 'managed' || instance.kind === 'external'

  return (
    <section
      aria-label={instance.label}
      className={clsx(
        'overflow-hidden rounded-xl border transition-colors',
        expanded ? 'border-zGray-700/80' : 'border-zGray-800/70',
      )}
    >
      <div className="flex items-center gap-2 py-3 pl-2 pr-3">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-1.5 py-1 text-left hover:bg-zGray-800/30"
        >
          <ChevronRight
            className={clsx(
              'h-4 w-4 shrink-0 text-tertiary transition-transform',
              expanded && 'rotate-90',
            )}
          />
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zGray-800/60 bg-surface">
            <Icon className="h-[18px] w-[18px] text-secondary" />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="truncate text-sm font-medium text-main" title={instance.label}>
                {instance.label}
              </h3>
              {kindTag && (
                <span className="shrink-0 rounded border border-zGray-800 px-1.5 text-[10px] uppercase tracking-wide text-tertiary">
                  {kindTag}
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs text-tertiary">
              {instance.provider === 'codex' ? 'Codex' : 'Claude Code'}
              {runtime?.runtimeVersion && <span> · v{runtime.runtimeVersion}</span>}
            </p>
          </div>
        </button>
        <span
          role="status"
          className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-secondary"
        >
          <span className={clsx('h-1.5 w-1.5 rounded-full', STATUS_DOT[status.tone])} />
          {status.label}
          {runtime?.online && runtime.latencyMs !== undefined && (
            <span className="text-tertiary">· {String(runtime.latencyMs)}ms</span>
          )}
          <QuotaBadge quota={quota} prefix="· " />
        </span>
        <RuntimeActionsMenu
          instance={instance}
          busy={busy}
          canEdit={canEdit}
          authenticated={runtime?.authenticated}
          onEdit={() => setEditing(true)}
          onSignIn={() => setSigningIn(true)}
          onToggleEnabled={() =>
            void mutate(() =>
              api.atlasUpdateRuntimeInstance(teamId, instance.id, {
                status: enabled ? 'disabled' : 'active',
              }),
            )
          }
          onRemove={() => setConfirmRemoval(true)}
        />
      </div>
      <RuntimeUpdateNotice
        update={statusError ? undefined : runtime?.runtimeUpdate}
        managed={instance.kind === 'managed'}
        canUpdate={canEdit && instance.kind === 'managed'}
        enabled={enabled}
        onUpdate={async () => {
          const result = await api.atlasRequestRuntimeUpdate(teamId, instance.id)

          setRuntime(
            (previous) =>
              previous && {
                ...previous,
                runtimeUpdate: {
                  ...previous.runtimeUpdate,
                  state: 'waiting',
                  targetVersion: result.version,
                  releaseUrl:
                    previous.runtimeUpdate?.releaseUrl ??
                    'https://github.com/nuphos/nuphos/releases?q=runtime-v',
                },
              },
          )
          setUpdateRevision((value) => value + 1)
        }}
      />
      {expanded && (
        <div className="divide-y divide-zGray-800/60 border-t border-zGray-800/60">
          {instance.deletion ? (
            <p className="px-4 py-3 text-xs leading-relaxed text-secondary" role="status">
              {instance.deletion.error ??
                'Saving conversation workspaces, then deleting the agent and its disk. Conversations stay in Nuphos and can be moved to another agent.'}
            </p>
          ) : editing ? (
            <div className="p-4">
              <RuntimeInstanceForm
                instance={instance}
                onCancel={() => setEditing(false)}
                onSave={async (input) => {
                  await api.atlasUpdateRuntimeInstance(teamId, instance.id, { label: input.label })
                  setEditing(false)
                  changed()
                }}
              />
            </div>
          ) : (
            <>
              <div className="px-4 py-4">
                <RuntimeOverview
                  instance={instance}
                  runtime={runtime}
                  quota={quota}
                  statusError={statusError}
                />
              </div>
              {hosted && enabled && (
                <RuntimeMetricsCharts teamId={teamId} runtimeId={instance.id} />
              )}
              {runtime?.credentialRevoked ? (
                <p className="px-4 py-4 text-xs leading-relaxed text-secondary">
                  The agent’s owner revoked this team’s connection from its console. Generate a new
                  pairing code there, connect again and choose Update existing connection.
                </p>
              ) : (
                hosted &&
                enabled &&
                runtime &&
                !statusError && (
                  <RuntimeSignIn
                    instance={instance}
                    authenticated={runtime.authenticated}
                    {...(canEdit && !busy ? { onSignIn: () => setSigningIn(true) } : {})}
                  />
                )
              )}
              <div className="px-4 py-4">
                <RuntimeDefaultsSection teamId={teamId} instance={instance} isAdmin={isAdmin} />
              </div>
            </>
          )}
        </div>
      )}
      {signingIn && (
        <RuntimeLoginDialog
          teamId={teamId}
          instance={instance}
          onClose={() => setSigningIn(false)}
        />
      )}
      {canEdit && (
        <ConfirmDialog
          open={confirmRemoval}
          title={`Remove ${instance.label}?`}
          description={
            instance.kind === 'managed'
              ? 'Nuphos will save conversation workspaces before permanently deleting this agent and its disk, including its sign-in. Your conversation history stays in Nuphos. Move a conversation to another agent to continue with reconstructed context. If a workspace cannot be saved, deletion pauses.'
              : 'This disconnects the external agent. Its files remain on the external machine. Your conversations stay in Nuphos and can be moved using conversation history.'
          }
          destructive
          confirmLabel="Remove agent"
          onConfirm={() => mutate(() => api.atlasRemoveRuntimeInstance(teamId, instance.id))}
          onClose={() => setConfirmRemoval(false)}
        />
      )}
    </section>
  )
}
