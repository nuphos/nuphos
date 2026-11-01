import { SkeletonReveal } from '../../components/SkeletonReveal'
import { t } from '../../i18n'
import {
  formatResetsAt,
  quotaLeftPercent,
  quotaNote,
  quotaWindowTone,
} from '../../lib/runtimeQuota'

import { PanelHeading, PanelStat } from './RuntimePanel'
import { QUOTA_FILL_CLASS, QUOTA_LABEL_CLASS, formatUptime } from './runtimePresentation'

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
      {note && <PanelStat label={t('Usage')}>{note}</PanelStat>}
      {quota?.available &&
        quota.windows.map((window) => {
          const reset = formatResetsAt(window.resetsAt, new Date())
          const left = quotaLeftPercent(window)
          const tone = quotaWindowTone(window)

          return (
            <PanelStat key={window.id} label={window.label} className="col-span-2">
              <span className={QUOTA_LABEL_CLASS[tone]}>
                {t('{percent}% left', { percent: left })}
              </span>
              {reset && <span className="text-tertiary"> · {reset}</span>}
              <div
                role="progressbar"
                aria-label={t('{name} remaining', { name: window.label })}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={left}
                className="mt-2 h-2 overflow-hidden rounded-full bg-zGray-800"
              >
                <div
                  className={`h-full rounded-full ${QUOTA_FILL_CLASS[tone]}`}
                  style={{ width: `${String(left)}%` }}
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
    body = <Note>{t('Enable this runtime to reconnect.')}</Note>
  } else if (statusError) {
    body = <Note tone="error">{t('Could not load runtime status. Retrying…')}</Note>
  } else if (!runtime) {
    body = <div aria-busy="true" className="h-10 animate-pulse rounded-md bg-zGray-800/40" />
  } else if (!runtime.configured) {
    body = (
      <Note>
        {t(
          'Nuphos is starting this workspace’s {name} agent; this usually takes about a minute. Sign in once the status changes to Online.',
          { name: instance.label },
        )}
      </Note>
    )
  } else {
    body = (
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <PanelStat label={t('Reachability')}>
          {runtime.online ? t('Online') : t('Unreachable')}
          {runtime.latencyMs !== undefined && (
            <span className="text-tertiary"> · {String(runtime.latencyMs)}ms</span>
          )}
        </PanelStat>
        <PanelStat label={t('Uptime')}>
          {runtime.uptimeSeconds === undefined ? '—' : formatUptime(runtime.uptimeSeconds)}
        </PanelStat>
        <PanelStat label={t('Agents')}>
          {runtime.attachedConversations === null
            ? t('Unavailable')
            : String(runtime.attachedConversations)}
          {(runtime.busyConversations ?? 0) > 0 && (
            <span className="text-tertiary">
              {' '}
              · {t('{count} active', { count: runtime.busyConversations ?? 0 })}
            </span>
          )}
        </PanelStat>
        <PanelStat label={t('Backend link')}>
          {runtime.connected ? t('Connected') : t('Idle')}
          {runtime.connectedAtMs !== undefined && (
            <span className="text-tertiary">
              {' '}
              · {formatUptime(Math.round((runtime.fetchedAtMs - runtime.connectedAtMs) / 1000))}
            </span>
          )}
        </PanelStat>
        {instance.image !== undefined && (
          <PanelStat label={t('Configured image')} className="col-span-2 sm:col-span-4">
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
      <PanelHeading title={t('Runtime details')} />
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
      <PanelHeading title={t('Usage')} />
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <QuotaStats quota={quota} />
      </dl>
    </section>
  )
}
