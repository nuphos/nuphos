import { SkeletonReveal } from '../../components/SkeletonReveal'
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
            <PanelStat key={window.id} label={window.label} className="col-span-2">
              {String(Math.round(window.usedPercent))}% used
              {reset && <span className="text-tertiary"> · {reset}</span>}
              <div
                role="progressbar"
                aria-label={`${window.label} usage`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.max(0, Math.min(100, window.usedPercent))}
                className="mt-2 h-2 overflow-hidden rounded-full bg-zGray-800"
              >
                <div
                  className="h-full rounded-full bg-zViolet-500"
                  style={{ width: `${Math.max(0, Math.min(100, window.usedPercent))}%` }}
                />
              </div>
            </PanelStat>
          )
        })}
    </>
  )
}

export function RuntimeOverview({
  instance,
  runtime,
  statusError,
}: {
  instance: RuntimeInstance
  runtime: PolledRuntimeStatus | null
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
      <PanelHeading title="Runtime details" />
      <SkeletonReveal
        ready={Boolean(runtime) || statusError || instance.status !== 'active'}
        skeleton={
          <div aria-busy="true" className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[0, 1, 2, 3].map((key) => (
              <div key={key} className="h-12 rounded-md bg-zGray-800/40" />
            ))}
          </div>
        }
      >
        {body}
      </SkeletonReveal>
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

export function RuntimeUsageSection({ quota }: { quota?: RuntimeQuota }) {
  return (
    <section>
      <PanelHeading title="Usage" />
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <QuotaStats quota={quota} />
      </dl>
    </section>
  )
}
