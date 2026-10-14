import clsx from 'clsx'
import { ChevronRight } from 'lucide-react'

import { AgentProviderIcon } from '../../components/agent/panel/icons'
import { quotaNote, quotaWindowLine } from '../../lib/runtimeQuota'
import { AGENT_PROVIDER } from '../../types/runtime'

import { ACCENT_RGB } from './MetricChart'

import type { MetricPoint } from './MetricChart'
import type { QuotaHistoryRow } from './quotaHistoryRows'
import type { RuntimeInstance, RuntimeQuota } from '../../types/runtime'

/** Shared by the header and every row so the columns line up. */
export const AGENT_USAGE_COLUMNS =
  'grid-cols-[minmax(0,1fr)_minmax(0,1fr)_16px] gap-5 @3xl:grid-cols-[minmax(0,1.4fr)_120px_minmax(0,1fr)_140px_16px]'

/** Usage fills match MetricChart's violet; the used-up orange is a token the theme leaves alone. */
export const USED_FILL = `rgb(${ACCENT_RGB})`
export const LIMIT_FILL = 'rgba(var(--color-zOrangered-500), 0.7)'

const percent = (value: number) => `${String(Math.round(value))}%`

const RUNS_ON: Record<RuntimeInstance['kind'], string> = {
  managed: 'Cloud',
  external: 'Self-hosted',
  development: 'Development',
  local: 'This computer',
}

function runsOn(instance: RuntimeInstance): string {
  const where = RUNS_ON[instance.kind]

  return instance.status === 'active' ? where : `${where} · Disabled`
}

/** One line per bucket, broken wherever nothing was read. */
function sparklinePath(points: MetricPoint[]): string {
  return points
    .map((p, i) => {
      if (p.value === null) return ''
      const command = points[i - 1]?.value == null ? 'M' : 'L'

      return `${command}${String(i)},${String(100 - Math.min(p.value, 100))}`
    })
    .join(' ')
}

/** One agent: who it is, where it runs, how much of each plan window is used now, and
 *  the shape of its busiest window over the chosen range. */
export function AgentUsageRow({
  instance,
  quota,
  row,
  selected,
  onSelect,
}: {
  instance: RuntimeInstance
  quota: RuntimeQuota | undefined
  row: QuotaHistoryRow | undefined
  selected: boolean
  onSelect: (runtimeId: string) => void
}) {
  const windows = quota?.available ? quota.windows : []
  const atLimit = windows.some((window) => window.usedPercent >= 100)
  const note = quotaNote(quota)

  return (
    <button
      type="button"
      onClick={() => onSelect(instance.id)}
      className={clsx(
        `t-agents-row group grid w-full cursor-pointer ${AGENT_USAGE_COLUMNS} items-center border-b border-zGray-800/60 px-4 py-2.5 text-left outline-none last:border-b-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zViolet-500/60`,
        selected ? 'bg-zViolet-500/[0.07]' : 'hover:bg-zGray-800/40',
      )}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zGray-800/70 bg-main">
          <AgentProviderIcon provider={instance.provider} className="h-4 w-4" />
        </span>
        <span className="truncate text-[13px] font-medium text-main">{instance.label}</span>
        {/* Runs on, which carries the status, is hidden when the page is narrow. */}
        {instance.status !== 'active' && (
          <span className="shrink-0 text-[11px] text-tertiary @3xl:hidden">Disabled</span>
        )}
        {atLimit && (
          <span className="shrink-0 rounded-full bg-zOrangered-500/10 px-2 py-0.5 text-[11px] text-zOrangered-400">
            At limit
          </span>
        )}
        <span className="ml-auto hidden shrink-0 text-[11px] text-tertiary @3xl:inline">
          {AGENT_PROVIDER[instance.provider].label}
        </span>
      </span>
      <span className="hidden items-center gap-1.5 text-[12px] text-secondary @3xl:flex">
        <span
          className={clsx(
            'h-1.5 w-1.5 rounded-full',
            instance.status === 'active' ? 'bg-zViolet-400' : 'bg-zGray-600',
          )}
        />
        {runsOn(instance)}
      </span>
      <span className="min-w-0 space-y-1">
        {windows.length === 0 ? (
          <span className="block truncate text-[11px] text-tertiary">{note ?? '—'}</span>
        ) : (
          windows.map((window) => (
            <span
              key={window.id}
              title={quotaWindowLine(window, new Date())}
              className="flex items-center gap-2 text-[11px]"
            >
              <span className="w-14 shrink-0 truncate text-tertiary">{window.label}</span>
              <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-zGray-800">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${String(Math.min(window.usedPercent, 100))}%`,
                    backgroundColor: window.usedPercent >= 100 ? LIMIT_FILL : USED_FILL,
                  }}
                />
              </span>
              <span
                className={clsx(
                  'w-9 shrink-0 text-right font-mono',
                  window.usedPercent >= 100 ? 'text-zOrangered-400' : 'text-main',
                )}
              >
                {percent(window.usedPercent)}
              </span>
            </span>
          ))
        )}
      </span>
      <span className="hidden h-6 @3xl:block">
        {row && (
          <svg
            aria-hidden="true"
            viewBox={`0 0 ${String(Math.max(row.peak.length - 1, 1))} 100`}
            preserveAspectRatio="none"
            className="h-full w-full overflow-visible"
          >
            <path
              d={sparklinePath(row.peak)}
              fill="none"
              stroke={atLimit ? LIMIT_FILL : USED_FILL}
              strokeWidth={1.5}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}
      </span>
      <ChevronRight
        aria-hidden="true"
        className={clsx(
          'h-4 w-4 text-tertiary transition-opacity',
          selected ? 'opacity-100' : 'opacity-40 group-hover:opacity-100',
        )}
      />
    </button>
  )
}
