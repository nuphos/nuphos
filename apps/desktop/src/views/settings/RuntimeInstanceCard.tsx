import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { useState } from 'react'

import { api } from '../../api'
import { AgentProviderIcon } from '../../components/agent/panel/icons'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { InlineRename } from '../../components/ui/inline-rename'
import { toast } from '../../components/ui/toast'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { RUNTIME_INSTANCES_CHANGED } from '../../hooks/useRuntimeInstances'
import { useThisComputer } from '../../hooks/useThisComputer'
import { t } from '../../i18n'
import { queryKeys } from '../../lib/query/keys'
import { useRuntimeStatusQuery } from '../../lib/query/runtime'
import { AGENT_PROVIDER } from '../../types/runtime'

import { AgentAddedBy } from './AgentAddedBy'
import { agentName, localSignIn } from './agentPresentation'
import { LocalAgentSignInRow } from './LocalAgentSignInRow'
import { RuntimeActionsMenu } from './RuntimeActionsMenu'
import { RuntimeLoginDialog } from './RuntimeLoginDialog'
import { RuntimeMetricsCharts } from './RuntimeMetricsCharts'
import { RuntimeOverview, RuntimeUsageSection } from './RuntimeOverview'
import { STATUS_DOT, runtimeRemovalDescription, runtimeStatusView } from './runtimePresentation'
import { removeRuntime } from './runtimeRemoval'
import { RuntimeSignIn } from './RuntimeSignIn'
import { RuntimeUpdateNotice } from './RuntimeUpdateNotice'
import { runtimeUpdatePresentation } from './runtimeUpdatePresentation'
import { RuntimeUsageBar } from './RuntimeUsageBar'

import type { PolledRuntimeStatus } from '../../lib/query/runtime'
import type { RuntimeInstance, RuntimeQuota } from '../../types/runtime'

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
  const me = useCurrentUser()
  const [signingIn, setSigningIn] = useState(false)
  const [cliSigningIn, setCliSigningIn] = useState(false)
  const signIn = localSignIn(instance, useThisComputer())
  const [editing, setEditing] = useState(false)
  const [confirmRemoval, setConfirmRemoval] = useState(false)
  const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()
  const statusKey = queryKeys.runtimeStatus(teamId, instance.id)
  const { data: runtime = null, isError: statusError } = useRuntimeStatusQuery(teamId, instance.id)
  const enabled = instance.status === 'active'

  const changed = () => window.dispatchEvent(new Event(RUNTIME_INSTANCES_CHANGED))
  const mutate = async (action: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await action()
      changed()
    } catch (error) {
      toast.apiError(t('Could not update runtime'), error)
    } finally {
      setBusy(false)
    }
  }
  // A computer's agent is not a team runtime: its name lives on that computer's row.
  const rename = (label: string) =>
    instance.local
      ? api.boxRenameAgent(
          instance.local.deviceId,
          teamId,
          instance.local.instanceId ?? instance.provider,
          label,
        )
      : api.atlasUpdateRuntimeInstance(teamId, instance.id, { label })
  // A computer's agents answer to its owner, not to a team role (box-access.ts).
  const canEdit =
    (instance.local ? instance.local.ownerUserId === me?.id : isAdmin) &&
    instance.kind !== 'development' &&
    !instance.deletion
  const status = runtimeStatusView(instance, runtime, statusError)
  const kindTag =
    instance.kind === 'external'
      ? t('External')
      : instance.kind === 'development'
        ? t('Local')
        : null
  const hosted = instance.kind === 'managed' || instance.kind === 'external'
  const updatable = instance.kind === 'managed'
  // A Box's update restarts its host and every agent on it, so it lives on the Box's card.
  const runtimeUpdate =
    statusError || instance.kind === 'local' ? undefined : runtime?.runtimeUpdate

  return (
    <section aria-label={instance.label} className="mx-auto w-full max-w-5xl">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-5">
        <div className="flex min-w-0 flex-1 basis-52 items-center gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line-control/70 bg-main shadow-sm">
            <AgentProviderIcon provider={instance.provider} className="h-5 w-5 text-secondary" />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="flex min-w-0 text-[16px] font-semibold tracking-tight text-main">
                <InlineRename
                  value={agentName(instance)}
                  {...(instance.local
                    ? { defaultName: AGENT_PROVIDER[instance.provider].label }
                    : {})}
                  canEdit={canEdit}
                  editing={editing}
                  onEditingChange={setEditing}
                  ariaLabel={t('Runtime name')}
                  errorTitle={t('Could not rename runtime')}
                  onSave={async (label) => {
                    await rename(label)
                    changed()
                  }}
                />
              </h3>
              {runtimeUpdate &&
                ['available', 'waiting', 'updating', 'failed'].includes(runtimeUpdate.state) && (
                  <span className="shrink-0 rounded border border-action-primary/30 bg-state-selected px-1.5 py-0.5 text-[10px] text-secondary">
                    {runtimeUpdatePresentation(runtimeUpdate, updatable, canEdit, enabled).title}
                  </span>
                )}
              {kindTag && (
                <span className="shrink-0 rounded border border-line-control px-1.5 text-[10px] uppercase tracking-wide text-tertiary">
                  {kindTag}
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs text-tertiary">
              {AGENT_PROVIDER[instance.provider].label}
              {instance.local && <span> · {instance.local.deviceLabel}</span>}
              {runtime?.runtimeVersion && <span> · v{runtime.runtimeVersion}</span>}
            </p>
            {instance.local?.addedBy && (
              <AgentAddedBy teamId={teamId} addedBy={instance.local.addedBy} />
            )}
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
          <RuntimeUsageBar quota={quota} />
        </span>
        <RuntimeActionsMenu
          instance={instance}
          busy={busy}
          canEdit={canEdit}
          authenticated={runtime?.authenticated}
          onRename={() => setEditing(true)}
          localSignIn={signIn !== undefined}
          onSignIn={() =>
            signIn && signIn !== 'runtime' ? setCliSigningIn(true) : setSigningIn(true)
          }
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
        update={runtimeUpdate}
        managed={updatable}
        canUpdate={canEdit && updatable}
        enabled={enabled}
        onUpdate={async () => {
          const result = await api.atlasRequestRuntimeUpdate(teamId, instance.id)

          queryClient.setQueryData<PolledRuntimeStatus>(
            statusKey,
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
          // Read again now; a read already on its way predates the request and is dropped.
          void queryClient.invalidateQueries({ queryKey: statusKey })
        }}
      />
      <div className="divide-y divide-line-control/60 border-t border-line-control/60">
        {instance.deletion ? (
          <p className="px-4 py-3 text-xs leading-relaxed text-secondary" role="status">
            {instance.deletion.error ??
              t('Removing the runtime and its files. Agent history stays in Nuphos.')}
          </p>
        ) : (
          <>
            {runtime?.credentialRevoked ? (
              <p className="px-4 py-4 text-xs leading-relaxed text-secondary">
                {t(
                  'The runtime’s owner revoked this team’s connection from its console. Generate a new pairing code there, connect again and choose Update existing connection.',
                )}
              </p>
            ) : signIn ? (
              <LocalAgentSignInRow
                signIn={signIn}
                cliOpen={cliSigningIn}
                onCliClosed={() => setCliSigningIn(false)}
                onRuntimeSignIn={() => setSigningIn(true)}
                busy={busy}
              />
            ) : (
              (hosted || runtime?.apiKey) &&
              enabled &&
              runtime &&
              !statusError && (
                <RuntimeSignIn
                  instance={instance}
                  runtime={runtime}
                  {...(canEdit && !busy ? { onSignIn: () => setSigningIn(true) } : {})}
                  {...(isAdmin ? {} : { memberOf: teamId })}
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
          apiKey={runtime?.apiKey === true}
          onClose={() => setSigningIn(false)}
        />
      )}
      {canEdit && (
        <ConfirmDialog
          open={confirmRemoval}
          title={t('Remove {name}?', { name: instance.label })}
          description={runtimeRemovalDescription(instance)}
          destructive
          confirmLabel={t('Remove runtime')}
          onConfirm={() => mutate(() => removeRuntime(instance, teamId))}
          onClose={() => setConfirmRemoval(false)}
        />
      )}
    </section>
  )
}
