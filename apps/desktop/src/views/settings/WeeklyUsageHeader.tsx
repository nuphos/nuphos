import clsx from 'clsx'

import { AgentProviderIcon } from '../../components/agent/panel/icons'
import { useThisComputer } from '../../hooks/useThisComputer'
import { t } from '../../i18n'
import { formatResetsDuration } from '../../lib/runtimeQuota'

import { agentDisplayName, agentRunsOn } from './agentPresentation'

import { dayTime } from './weeklyPace'

import type { WeeklyPace } from './weeklyPace'
import type { RuntimeInstance, RuntimeQuota, RuntimeQuotaWindow } from '../../types/runtime'

const HOUR = 3_600_000

/** What the pace since the last reset says about the rest of the week. */
function paceText(pace: WeeklyPace, resetsAt: number, fallbackName: string | null): string {
  switch (pace.kind) {
    case 'tooFew':
      return t('Too few readings since the reset to estimate the pace.')
    case 'onPace':
      return t('At this pace, about {percent}% will be used by the reset.', {
        percent: pace.atReset,
      })
    case 'runsOut': {
      const line = t('At this pace it runs out {when}, about {hours}h before the reset.', {
        when: dayTime(pace.at),
        hours: Math.round((resetsAt - pace.at) / HOUR),
      })

      return fallbackName ? `${line} ${t('Then its Bots and Tasks switch to the fallback.')}` : line
    }
    case 'usedUp':
      return fallbackName
        ? t('Its Bots and Tasks use the fallback, {name}, until the reset.', { name: fallbackName })
        : ''
  }
}

/** Which runtime, how much of its week is used, when it resets and what the pace says. */
export function WeeklyUsageHeader({
  instance,
  quota,
  window,
  pace,
  fallbackName,
  nowMs,
}: {
  instance: RuntimeInstance
  quota: RuntimeQuota | undefined
  window: RuntimeQuotaWindow
  pace: WeeklyPace
  fallbackName: string | null
  nowMs: number
}) {
  const thisComputer = useThisComputer()
  const resetsAt = Date.parse(window.resetsAt ?? '')
  const used = Math.round(window.usedPercent)
  const reset = new Date(resetsAt).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  const paceLine = paceText(pace, resetsAt, fallbackName)

  return (
    <div className="flex flex-col gap-3 @3xl:flex-row @3xl:justify-between">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-main">
          <AgentProviderIcon provider={instance.provider} className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{agentDisplayName(instance)}</span>
          <span className="shrink-0 rounded border border-line-control/70 px-1.5 py-0.5 text-[11px] font-normal text-secondary">
            {agentRunsOn(instance, thisComputer, quota)}
          </span>
        </div>
        <p className="mt-2 flex items-baseline gap-2">
          {pace.kind === 'usedUp' ? (
            <>
              <span className="text-[26px] leading-none text-error">{t('Used up')}</span>
              {pace.since !== null && (
                <span className="text-[13px] text-secondary">
                  {t('since {when}', { when: dayTime(pace.since) })}
                </span>
              )}
            </>
          ) : (
            <>
              <span className="font-mono text-[26px] leading-none text-main">{used}%</span>
              <span className="text-[13px] text-secondary">{t('of the weekly limit used')}</span>
            </>
          )}
        </p>
      </div>
      <div className="text-[12px] @3xl:max-w-[60%] @3xl:text-right">
        <p className="font-medium text-main">{t('Next reset {when}', { when: reset })}</p>
        <p className="text-tertiary">
          {t('in {time}', { time: formatResetsDuration(window.resetsAt, new Date(nowMs)) ?? '—' })}
        </p>
        {paceLine && (
          <p
            className={clsx(
              'mt-0.5',
              pace.kind === 'runsOut' || pace.kind === 'usedUp' ? 'text-error' : 'text-secondary',
            )}
          >
            {paceLine}
          </p>
        )}
      </div>
    </div>
  )
}
