import clsx from 'clsx'
import { AlarmClock } from 'lucide-react'

import { locale, t } from '../../../i18n'
import { viewerTimeZone } from '../../../views/triggers/cronTime'
import { Tooltip } from '../../ui/tooltip'

import { allPaused, clockTooltipLines } from './bindings'
import { useBoundTriggers } from './useBoundTriggers'

/**
 * A sidebar row's schedule mark: this conversation (or, for a Bot's chat, the
 * Bot's own Task) receives a Trigger's fires. Faint while every one is paused.
 */
export function TriggerClockMark({
  teamId,
  sessionIds,
}: {
  teamId: string
  sessionIds: readonly (string | undefined)[]
}) {
  const triggers = useBoundTriggers(teamId, sessionIds)

  if (triggers.length === 0) return null
  const paused = allPaused(triggers)
  const label = paused ? t('Scheduled, paused') : t('Scheduled')
  const lines = clockTooltipLines(triggers, new Date(), viewerTimeZone(), locale)

  return (
    <Tooltip
      content={
        <span className="flex flex-col gap-0.5">
          {lines.map((line, index) => (
            <span key={triggers[index]?.id ?? line}>{line}</span>
          ))}
        </span>
      }
    >
      <span
        role="img"
        aria-label={`${label}: ${lines.join('; ')}`}
        data-testid="chat-trigger-mark"
        className={clsx(
          'flex size-[18px] flex-shrink-0 items-center justify-center',
          paused ? 'text-tertiary opacity-50' : 'text-tertiary',
        )}
      >
        <AlarmClock className="size-3" strokeWidth={1.9} aria-hidden />
      </span>
    </Tooltip>
  )
}
