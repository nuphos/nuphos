import clsx from 'clsx'

import { AgentProviderIcon } from '../../components/agent/panel/icons'
import { useThisComputer } from '../../hooks/useThisComputer'
import { t } from '../../i18n'
import { mostConstrainedWindow, quotaNote, quotaWindowLine } from '../../lib/runtimeQuota'

import { agentDisplayName, agentOffline, agentRunsOn } from './agentPresentation'
import { STATUS_DOT } from './runtimePresentation'
import { atLimitHours } from './weeklyPace'

import type { MetricPoint } from './MetricChart'
import type { RuntimeInstance, RuntimeQuota } from '../../types/runtime'

/** Shared by the header and every row so the columns line up. The 7-day strip needs the
 *  width a wide page has. */
export const AGENT_USAGE_COLUMNS =
  'grid-cols-[minmax(0,1fr)_150px_40px] gap-4 @3xl:grid-cols-[minmax(0,1fr)_170px_minmax(140px,200px)_40px]'

/** The used-up orange is a token the theme leaves alone. */
const LIMIT_FILL = 'rgba(var(--color-status-attention), 0.7)'

/** Each stretch of hours at a limit, as a share of the strip. */
function limitRuns(peak: readonly MetricPoint[]): { left: number; width: number }[] {
  const runs: { left: number; width: number }[] = []
  const step = 100 / peak.length

  peak.forEach((point, i) => {
    if ((point.value ?? 0) < 100) return
    const last = runs.at(-1)

    if (last && Math.abs(last.left + last.width - i * step) < step / 2) last.width += step
    else runs.push({ left: i * step, width: step })
  })

  return runs
}

/** The busiest plan window as a bar, red and marked Limit once used up; every window on hover. */
function PlanUsed({ quota }: { quota: RuntimeQuota | undefined }) {
  const worst = mostConstrainedWindow(quota)

  if (!worst)
    return <span className="truncate text-[11px] text-tertiary">{quotaNote(quota) ?? '—'}</span>
  const used = Math.min(100, Math.round(worst.usedPercent))
  const atLimit = used >= 100
  const now = new Date()

  return (
    <span
      title={
        quota?.available ? quota.windows.map((w) => quotaWindowLine(w, now)).join('\n') : undefined
      }
      className="flex items-center gap-2 text-[11px]"
    >
      <span
        role="progressbar"
        aria-label={t('Plan used now')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={used}
        className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-sunken"
      >
        <span
          className={clsx('block h-full rounded-full', atLimit ? 'bg-error' : 'bg-data-1')}
          style={{ width: `${String(used)}%` }}
        />
      </span>
      <span
        className={clsx('w-9 shrink-0 text-right font-mono', atLimit ? 'text-error' : 'text-main')}
      >
        {atLimit ? t('Limit') : `${String(used)}%`}
      </span>
    </span>
  )
}

/** One runtime: who it is, where it runs, how much of its plan is used now and how
 *  long it sat at a limit over the last 7 days. */
export function AgentUsageRow({
  instance,
  quota,
  peak,
  selected,
  onSelect,
}: {
  instance: RuntimeInstance
  quota: RuntimeQuota | undefined
  /** Each hour's busiest window over the last 7 days; absent before history loads. */
  peak: MetricPoint[] | undefined
  selected: boolean
  onSelect: (runtimeId: string) => void
}) {
  const thisComputer = useThisComputer()
  const hours = peak ? atLimitHours(peak) : 0

  return (
    <button
      type="button"
      onClick={() => onSelect(instance.id)}
      className={clsx(
        `t-agents-row grid w-full cursor-pointer ${AGENT_USAGE_COLUMNS} items-center rounded-md px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-line-focus`,
        selected ? 'bg-action-primary/[0.07]' : 'hover:bg-state-hover',
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <AgentProviderIcon provider={instance.provider} className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate text-[13px] font-medium text-main">
          {agentDisplayName(instance)}
        </span>
        <span className="flex min-w-0 shrink items-center gap-1.5 rounded border border-line-control/70 px-1.5 py-0.5 text-[11px] text-secondary">
          <span
            className={clsx(
              'h-1.5 w-1.5 shrink-0 rounded-full',
              instance.status === 'active' && !agentOffline(instance, quota)
                ? STATUS_DOT.online
                : STATUS_DOT.off,
            )}
          />
          <span className="truncate">
            {instance.status === 'active'
              ? agentRunsOn(instance, thisComputer, quota)
              : t('Disabled')}
          </span>
        </span>
      </span>
      <PlanUsed quota={quota} />
      <span className="relative hidden h-2 overflow-hidden rounded-sm bg-surface-sunken @3xl:block">
        {peak &&
          limitRuns(peak).map((run) => (
            <span
              key={run.left}
              className="absolute inset-y-0"
              style={{
                left: `${String(run.left)}%`,
                width: `${String(run.width)}%`,
                backgroundColor: LIMIT_FILL,
              }}
            />
          ))}
      </span>
      <span
        className={clsx(
          'text-right font-mono text-[11px]',
          hours > 0 ? 'text-error' : 'text-tertiary',
        )}
      >
        {hours > 0 ? t('{hours} h', { hours }) : '–'}
      </span>
    </button>
  )
}
