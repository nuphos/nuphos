import { formatResetsAt, quotaNote } from '../../lib/runtimeQuota'

import { PanelHeading, PanelStat } from './RuntimePanel'
import { formatUptime } from './runtimePresentation'

import type { RuntimeInstance, RuntimeQuota } from '../../types/runtime'
import type { OpenAbRuntimeStatus } from '../../types/team'

export type PolledRuntimeStatus = OpenAbRuntimeStatus & { fetchedAtMs: number }

/** One stat per provider usage window — or, when the agent could not report
 *  them, why. This is where a reason belongs: the composer's chip shows a
 *  figure or nothing, and "Sign in required" is something you act on here. */
function QuotaStats({ quota }: { quota?: RuntimeQuota }) {
  const note = quotaNote(quota)

  return (
    <>
      {note && <PanelStat label="Usage">{note}</PanelStat>}
      {quota?.available &&
        quota.windows.map((window) => {
          const reset = formatResetsAt(window.resetsAt, new Date())

          return (
            <PanelStat key={window.id} label={window.label}>
              {String(Math.round(window.usedPercent))}% used
              {reset && <span className="text-tertiary"> · {reset}</span>}
            </PanelStat>
          )
        })}
    </>
  )
}

export function RuntimeOverview({
  instance,
  runtime,
  quota,
  statusError,
}: {
  instance: RuntimeInstance
  runtime: PolledRuntimeStatus | null
  quota?: RuntimeQuota
  statusError: boolean
}) {
  let body: React.ReactNode

  if (instance.status !== 'active') {
    body = <Note>Enable this agent to reconnect.</Note>
  } else if (statusError) {
    body = <Note tone="error">Could not load agent status. Retrying…</Note>
  } else if (!runtime) {
    body = <div aria-busy="true" className="h-10 animate-pulse rounded-md bg-zGray-800/40" />
  } else if (!runtime.configured) {
    body = (
      <Note>
        Nuphos is starting this workspace’s {instance.label} agent; this usually takes about a
        minute. Sign in once the status changes to Online.
      </Note>
    )
  } else {
    body = (
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <PanelStat label="Reachability">
          {runtime.online ? 'Online' : 'Unreachable'}
          {runtime.latencyMs !== undefined && (
            <span className="text-tertiary"> · {String(runtime.latencyMs)}ms</span>
          )}
        </PanelStat>
        <PanelStat label="Uptime">
          {runtime.uptimeSeconds === undefined ? '—' : formatUptime(runtime.uptimeSeconds)}
        </PanelStat>
        <PanelStat label="Conversations">
          {runtime.attachedConversations === null
            ? 'Unavailable'
            : String(runtime.attachedConversations)}
          {(runtime.busyConversations ?? 0) > 0 && (
            <span className="text-tertiary"> · {String(runtime.busyConversations)} active</span>
          )}
        </PanelStat>
        <PanelStat label="Backend link">
          {runtime.connected ? 'Connected' : 'Idle'}
          {runtime.connectedAtMs !== undefined && (
            <span className="text-tertiary">
              {' '}
              · {formatUptime(Math.round((runtime.fetchedAtMs - runtime.connectedAtMs) / 1000))}
            </span>
          )}
        </PanelStat>
        <QuotaStats quota={quota} />
        {instance.image !== undefined && (
          <PanelStat label="Configured image" className="col-span-2 sm:col-span-4">
            <span className="font-mono text-[12px]" title={instance.image}>
              {instance.image.slice(instance.image.lastIndexOf('/') + 1)}
            </span>
          </PanelStat>
        )}
      </dl>
    )
  }

  return (
    <div>
      <PanelHeading title="Status" />
      {body}
    </div>
  )
}

function Note({
  children,
  tone = 'muted',
}: {
  children: React.ReactNode
  tone?: 'muted' | 'error'
}) {
  return (
    <p
      className={tone === 'error' ? 'text-xs text-error' : 'text-xs leading-relaxed text-tertiary'}
    >
      {children}
    </p>
  )
}
