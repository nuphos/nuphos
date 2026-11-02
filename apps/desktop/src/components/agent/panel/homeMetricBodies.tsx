import clsx from 'clsx'
import { Flame, Moon } from 'lucide-react'

import { t } from '../../../i18n'

import { dayCount, formatHours, workdays } from './homeMetricFormat'
import { BigNumber, Caption, Change, SessionName } from './homeMetricShell'

import type { MetricBodyProps } from './homeMetricShell'

// A streak this long earns a word of praise even before it is a record.
const ROLL_DAYS = 3

export function AgentTimeBody({ stats }: MetricBodyProps) {
  const { current, previous, range } = stats
  const { value, unit } = formatHours(current.agentMs)

  return (
    <>
      <BigNumber value={value} unit={unit}>
        <Change current={current.agentMs} previous={previous.agentMs} range={range} />
      </BigNumber>
      <Caption>
        {workdays(current.agentMs)} ·{' '}
        {current.turns === 1 ? t('1 turn') : t('{n} turns', { n: current.turns })}
      </Caption>
    </>
  )
}

export function SessionsBody({ stats, onOpenConversation }: MetricBodyProps) {
  const { current, previous, fanOut, peak, range } = stats

  return (
    <>
      <div className="flex items-end gap-6">
        <div>
          <BigNumber value={current.sessions}>
            <Change current={current.sessions} previous={previous.sessions} range={range} />
          </BigNumber>
          <div className="mt-1 text-[11px] text-tertiary">{t('sessions')}</div>
        </div>
        <div>
          <BigNumber value={current.subAgents} />
          <div className="mt-1 text-[11px] text-tertiary">{t('sub-agents')}</div>
        </div>
      </div>
      <div className="mt-auto min-w-0 text-[11.5px] leading-4">
        {fanOut && (
          <>
            <div className="truncate text-tertiary">
              {fanOut.count === 1
                ? t('Biggest fan-out: 1 sub-agent from')
                : t('Biggest fan-out: {n} sub-agents from', { n: fanOut.count })}
            </div>
            {/* The session gets a line of its own, so its title is never cut to a letter. */}
            <div className="truncate">
              <SessionName session={fanOut.session} onOpen={onOpenConversation} />
            </div>
          </>
        )}
        {peak && <div className="text-tertiary">{t('Up to {n} at once', { n: peak.count })}</div>}
      </div>
    </>
  )
}

export function PullRequestsBody({ stats }: MetricBodyProps) {
  const { current, previous, scope, range } = stats
  const overnight = current.prsMergedOvernight
  let night = t('{n} merged overnight', { n: overnight })

  if (scope === 'me') {
    night =
      overnight === 1
        ? t('1 merged while you slept')
        : t('{n} merged while you slept', { n: overnight })
  } else if (overnight === 1) {
    night = t('1 merged overnight')
  }

  return (
    <>
      <BigNumber value={current.prsMerged} unit={t('merged')}>
        <Change current={current.prsMerged} previous={previous.prsMerged} range={range} />
      </BigNumber>
      <Caption>
        {current.prsOpened === 1
          ? t('1 linked to an agent')
          : t('{n} linked to agents', { n: current.prsOpened })}
      </Caption>
      {overnight > 0 && (
        <div className="mt-auto flex items-center gap-1.5 text-[11.5px] text-secondary">
          <Moon className="h-3 w-3 flex-none text-heatmap-3" strokeWidth={2} />
          <span className="truncate">{night}</span>
        </div>
      )}
    </>
  )
}

export function StreakBody({ stats }: MetricBodyProps) {
  const { current, best, lookbackDays } = stats.streak
  const record = current > 0 && current === best
  let praise: string | null = null

  if (record) praise = t('Best yet')
  else if (current >= ROLL_DAYS) praise = t('On a roll')

  return (
    <>
      <div className="flex items-center gap-2">
        <span
          className={clsx(
            'flex h-7 w-7 flex-none items-center justify-center rounded-md',
            current > 0 ? 'bg-warning/10 text-warning' : 'bg-zGray-800/40 text-tertiary',
          )}
        >
          <Flame className="h-4 w-4" strokeWidth={1.8} />
        </span>
        <BigNumber value={current} unit={current === 1 ? t('day') : t('days')}>
          {praise && (
            <span className="self-center rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
              {praise}
            </span>
          )}
        </BigNumber>
      </div>
      <Caption>
        {t('Best: {streak} in the last {n} days', { streak: dayCount(best), n: lookbackDays })}
      </Caption>
    </>
  )
}
