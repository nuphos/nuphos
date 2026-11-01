import clsx from 'clsx'

import { t } from '../../../i18n'
import { AGENT_PROVIDER, AGENT_PROVIDERS } from '../../../types/runtime.ts'
import { Tooltip } from '../../ui/tooltip'

import { formatDuration, formatHours, runtimeShares, shortDateTime } from './homeMetricFormat'
import { BigNumber, SessionName } from './homeMetricShell'
import { AgentProviderIcon } from './icons'

import type { MetricBodyProps } from './homeMetricShell'
import type { AgentProvider } from '../../../types/runtime.ts'

// Darkest first, so the largest share stands out in both themes.
const SHADES = ['bg-heatmap-4', 'bg-heatmap-3', 'bg-heatmap-2', 'bg-heatmap-1']
const MAX_RUNTIMES = 3
const MARATHON_MS = 2 * 60 * 60_000

const isProvider = (runtime: string | null): runtime is AgentProvider =>
  (AGENT_PROVIDERS as readonly (string | null)[]).includes(runtime)

export function LongestRunBody({ stats, onOpenConversation }: MetricBodyProps) {
  if (!stats.longest) return null
  const { ms, startedAt, session } = stats.longest
  const started = t('Started {when}', { when: shortDateTime(startedAt) })

  return (
    <>
      <BigNumber value={formatDuration(ms)}>
        {ms >= MARATHON_MS && (
          <span className="flex-none self-center whitespace-nowrap rounded-full bg-zGray-800/40 px-2 py-0.5 text-[11px] text-secondary">
            {t('Marathon')}
          </span>
        )}
        {/* Hidden on a narrow card rather than cut short, but still read out; hovering the session shows it. */}
        <span className="sr-only min-w-0 truncate text-[11.5px] text-tertiary @xs:not-sr-only @xs:truncate">
          {started}
        </span>
      </BigNumber>
      <div className="mt-1.5 min-w-0 truncate text-[11.5px] leading-4">
        <Tooltip content={started} triggerClassName="min-w-0 max-w-full">
          <SessionName session={session} onOpen={onOpenConversation} />
        </Tooltip>
      </div>
    </>
  )
}

export function RuntimeMixBody({ stats }: MetricBodyProps) {
  const shares = runtimeShares(stats.runtimes)

  return (
    <>
      <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full">
        {shares.map((s, i) => (
          <div
            key={s.runtime ?? 'other'}
            className={SHADES[i] ?? 'bg-heatmap-1'}
            style={{ width: `${String(s.percent)}%` }}
          />
        ))}
      </div>
      <div className="mt-auto space-y-1">
        {shares.slice(0, MAX_RUNTIMES).map((s, i) => {
          const time = formatHours(s.agentMs)

          return (
            <div key={s.runtime ?? 'other'} className="flex items-center gap-2 text-[12px]">
              <span className={clsx('h-2 w-2 flex-none rounded-full', SHADES[i])} />
              <AgentProviderIcon
                provider={isProvider(s.runtime) ? s.runtime : null}
                className="h-3.5 w-3.5 flex-none"
              />
              <span className="truncate text-secondary">
                {isProvider(s.runtime) ? AGENT_PROVIDER[s.runtime].label : t('Other')}
              </span>
              <span className="ml-auto flex-none text-tertiary tabular-nums">
                {`${time.value} ${time.unit} · ${String(s.percent)}%`}
              </span>
            </div>
          )
        })}
      </div>
    </>
  )
}
