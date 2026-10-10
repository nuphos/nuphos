import clsx from 'clsx'
import { useEffect, useState } from 'react'

import { api } from '../../api'
import { AgentProviderIcon } from '../../components/agent/panel/icons'
import { RuntimeUsageBar } from './RuntimeUsageBar'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { toast } from '../../components/ui/toast'
import { RUNTIME_INSTANCES_CHANGED } from '../../hooks/useRuntimeInstances'
import { AGENT_PROVIDER } from '../../types/runtime'

import { RuntimeActionsMenu } from './RuntimeActionsMenu'
import { RuntimeInstanceForm } from './RuntimeInstanceForm'
import { RuntimeLoginDialog } from './RuntimeLoginDialog'
import { RuntimeMetricsCharts } from './RuntimeMetricsCharts'
import { RuntimeOverview, RuntimeUsageSection } from './RuntimeOverview'
import { STATUS_DOT, runtimeStatusView } from './runtimePresentation'
import { RuntimeSignIn } from './RuntimeSignIn'
import { runtimeUpdatePresentation } from './runtimeUpdatePresentation'
import { RuntimeUpdateNotice } from './RuntimeUpdateNotice'

import type { PolledRuntimeStatus } from './RuntimeOverview'
import type { RuntimeInstance, RuntimeQuota } from '../../types/runtime'

const STATUS_POLL_MS = 10_000
const STARTING_POLL_MS = 2_000

/** Details for the agent selected in the left-hand list. */
export function RuntimeInstanceCard({
  teamId,
  instance,
  quota,
  isAdmin,
}: {
  teamId: string
  instance: RuntimeInstance
  quota?: RuntimeQuota
  isAdmin: boolean
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
  const canEdit = isAdmin && instance.kind !== 'development' && !instance.deletion
  const status = runtimeStatusView(instance, runtime, statusError)
  const kindTag =
    instance.kind === 'external' ? 'External' : instance.kind === 'development' ? 'Local' : null
  const hosted = instance.kind === 'managed' || instance.kind === 'external'

  return (
    <section aria-label={instance.label} className="mx-auto w-full max-w-5xl">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-5">
        <div className="flex min-w-0 flex-1 basis-52 items-center gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-zGray-800/70 bg-main shadow-sm">
            <AgentProviderIcon provider={instance.provider} className="h-5 w-5 text-secondary" />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3
                className="truncate text-[16px] font-semibold tracking-tight text-main"
                title={instance.label}
              >
                {instance.label}
              </h3>
              {!statusError &&
                runtime?.runtimeUpdate &&
                ['available', 'waiting', 'updating', 'failed'].includes(
                  runtime.runtimeUpdate.state,
                ) && (
                  <span className="shrink-0 rounded border border-zViolet-500/30 bg-zViolet-500/10 px-1.5 py-0.5 text-[10px] text-zViolet-400">
                    {
                      runtimeUpdatePresentation(
                        runtime.runtimeUpdate,
                        instance.kind === 'managed',
                        canEdit,
                        enabled,
                      ).title
                    }
                  </span>
                )}
              {kindTag && (
                <span className="shrink-0 rounded border border-zGray-800 px-1.5 text-[10px] uppercase tracking-wide text-tertiary">
                  {kindTag}
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs text-tertiary">
              {AGENT_PROVIDER[instance.provider].label}
              {runtime?.runtimeVersion && <span> · v{runtime.runtimeVersion}</span>}
            </p>
          </div>
        </div>
        <span
          role="status"
          className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-secondary"
        >
          <span className={clsx('h-1.5 w-1.5 rounded-full', STATUS_DOT[status.tone])} />
          {status.label}
          {runtime?.online && runtime.latencyMs !== undefined && (
            <span className="text-tertiary">· {String(runtime.latencyMs)}ms</span>
          )}
          {quota?.available && quota.windows.length > 0 && (
            <RuntimeUsageBar
              window={quota.windows.reduce(
                (highest, window) => (window.usedPercent > highest.usedPercent ? window : highest),
                quota.windows[0],
              )}
            />
          )}
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
            <div className="px-5 py-6">
              <RuntimeUsageSection quota={quota} />
            </div>
            <div className="px-5 py-6">
              <RuntimeOverview instance={instance} runtime={runtime} statusError={statusError} />
            </div>
            {hosted && enabled && <RuntimeMetricsCharts teamId={teamId} runtimeId={instance.id} />}
          </>
        )}
      </div>
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
              ? 'This permanently deletes the agent, its disks, workspaces, and sign-in, and stops running conversations. Your conversation history stays in Nuphos. Move any workspace you want to keep to another agent before removing this one.'
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
