import { useEffect, useState } from 'react'

import { t } from '../../../i18n'
import { nextOccurrencesAfter } from '../../../views/triggers/calendar/occurrences'
import { formatViewerRun, sourceScheduleRule } from '../../../views/triggers/scheduleDisplay'

import { pausedNote, untilRun } from './triggerCards'

import type { AgentTrigger } from '../../../api/agent-trigger-types'

// Next runs move on as time passes; a minute is as fine as they are shown.
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)

    return () => window.clearInterval(timer)
  }, [])

  return now
}

export function NextRuns({ trigger }: { trigger: AgentTrigger }) {
  const now = useMinuteClock()
  const runs = nextOccurrencesAfter(trigger.cronExpression ?? '', now, 3, trigger.timeZone)

  if (!trigger.enabled) return <p className="text-[12.5px] text-tertiary">{pausedNote(trigger)}</p>
  if (runs.length === 0) {
    return <p className="text-[12.5px] text-tertiary">{t('No upcoming runs for this schedule.')}</p>
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11.5px] font-medium text-tertiary">{t('Next runs, your time')}</span>
      <ul className="flex flex-col gap-0.5 text-[12.5px]">
        {runs.map((run) => (
          <li key={run.getTime()} className="flex items-baseline gap-1.5">
            <span className="tabular-nums text-main">{formatViewerRun(run)}</span>
            <span className="text-tertiary">{untilRun(run, now)}</span>
          </li>
        ))}
      </ul>
      <p className="text-[11.5px] text-tertiary">{sourceScheduleRule(trigger)}</p>
    </div>
  )
}
