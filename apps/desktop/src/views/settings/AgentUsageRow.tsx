import clsx from 'clsx'
import { ChevronRight } from 'lucide-react'

import { AgentProviderIcon } from '../../components/agent/panel/icons'
import { useThisComputer } from '../../hooks/useThisComputer'
import { t } from '../../i18n'
import {
  quotaLeftPercent,
  quotaNote,
  quotaWindowLine,
  quotaWindowTone,
} from '../../lib/runtimeQuota'

import { agentDisplayName, agentOffline, agentRunsOn } from './agentPresentation'
import { QUOTA_FILL_CLASS, QUOTA_LABEL_CLASS, STATUS_DOT } from './runtimePresentation'
import { ResetsIn } from './RuntimeUsageBar'

import type { RuntimeInstance, RuntimeQuota } from '../../types/runtime'

/** Shared by the header and every row so the columns line up. */
export const AGENT_USAGE_COLUMNS =
  'grid-cols-[minmax(0,1fr)_minmax(0,1fr)_16px] gap-5 @3xl:grid-cols-[minmax(0,1.4fr)_160px_minmax(0,1fr)_16px]'

/** The used-up orange is a token the theme leaves alone. */
export const LIMIT_FILL = 'rgba(var(--color-status-attention), 0.7)'

/** One agent: who it is, where it runs, and how much of each plan window is left now,
 *  read the same way as its details panel. */
export function AgentUsageRow({
  instance,
  quota,
  selected,
  onSelect,
}: {
  instance: RuntimeInstance
  quota: RuntimeQuota | undefined
  selected: boolean
  onSelect: (runtimeId: string) => void
}) {
  const thisComputer = useThisComputer()
  const windows = quota?.available ? quota.windows : []
  const atLimit = windows.some((window) => window.usedPercent >= 100)
  const note = quotaNote(quota)

  return (
    <button
      type="button"
      onClick={() => onSelect(instance.id)}
      className={clsx(
        `t-agents-row group grid w-full cursor-pointer ${AGENT_USAGE_COLUMNS} items-center border-b border-line-control/60 px-4 py-2.5 text-left outline-none last:border-b-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-line-focus`,
        selected ? 'bg-action-primary/[0.07]' : 'hover:bg-state-hover',
      )}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line-control/70 bg-main">
          <AgentProviderIcon provider={instance.provider} className="h-4 w-4" />
        </span>
        <span className="truncate text-[13px] font-medium text-main">
          {agentDisplayName(instance)}
        </span>
        {/* Runs on, which carries the status, is hidden when the page is narrow. */}
        {instance.status !== 'active' && (
          <span className="shrink-0 text-[11px] text-tertiary @3xl:hidden">{t('Disabled')}</span>
        )}
        {atLimit && (
          <span className="shrink-0 rounded-full bg-status-attention/10 px-2 py-0.5 text-[11px] text-status-attention">
            {t('At limit')}
          </span>
        )}
      </span>
      <span className="hidden items-center gap-1.5 text-[12px] text-secondary @3xl:flex">
        <span
          className={clsx(
            'h-1.5 w-1.5 rounded-full',
            instance.status === 'active' && !agentOffline(instance, quota)
              ? STATUS_DOT.online
              : STATUS_DOT.off,
          )}
        />
        {agentRunsOn(instance, thisComputer, quota)}
      </span>
      <span className="min-w-0 space-y-1">
        {windows.length === 0 ? (
          <span className="block truncate text-[11px] text-tertiary">{note ?? '—'}</span>
        ) : (
          windows.map((window) => {
            const left = quotaLeftPercent(window)
            const tone = quotaWindowTone(window)

            return (
              <span
                key={window.id}
                title={quotaWindowLine(window, new Date())}
                className="flex items-center gap-2 text-[11px]"
              >
                <span className="w-14 shrink-0 truncate text-tertiary">{window.label}</span>
                <span
                  role="progressbar"
                  aria-label={t('{name} remaining', { name: window.label })}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={left}
                  // A spent window has no fill left to colour, so its track carries the red.
                  className={`h-1.5 min-w-0 flex-1 overflow-hidden rounded-full ${tone === 'exhausted' ? 'bg-error/30' : 'bg-surface-sunken'}`}
                >
                  <span
                    className={`block h-full rounded-full ${QUOTA_FILL_CLASS[tone]}`}
                    style={{ width: `${String(left)}%` }}
                  />
                </span>
                <span
                  className={clsx(
                    'w-16 shrink-0 whitespace-nowrap text-right font-mono',
                    QUOTA_LABEL_CLASS[tone] || 'text-main',
                  )}
                >
                  {t('{percent}% left', { percent: left })}
                </span>
                {/* Too narrow for the reset beside the details panel, which shows it. */}
                <span className="hidden @3xl:contents">
                  <ResetsIn resetsAt={window.resetsAt} />
                </span>
              </span>
            )
          })
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
