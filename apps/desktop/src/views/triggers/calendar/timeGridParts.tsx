import { Webhook } from 'lucide-react'
import { useMemo } from 'react'

import { eventChipClasses, formatEventTime, sameDay } from './model'
import { layoutDayEvents, SLOT_MINUTES } from './occurrences'
import { isWeekend, MINUTE_HEIGHT } from './timeGridMeta'

import type { ScheduleEvent } from './model'

const WEEKDAY_FMT = new Intl.DateTimeFormat('en-US', { weekday: 'short' })

/** One cell of the sliding day-header strip. */
export function DayHeaderCell({ day, now }: { day: Date; now: Date }) {
  return (
    <div
      className={`flex flex-1 items-baseline justify-center gap-1.5 border-l border-main/60 py-2 text-[12px] ${isWeekend(day) ? 'bg-zGray-800/25' : ''}`}
    >
      <span className="text-tertiary">{WEEKDAY_FMT.format(day)}</span>
      {sameDay(day, now) ? (
        <span className="rounded-[5px] bg-zOrangered-500 px-1.5 font-semibold text-white">
          {day.getDate()}
        </span>
      ) : (
        <span className="font-medium text-main">{day.getDate()}</span>
      )}
    </div>
  )
}

export function DayColumn({
  events,
  weekend,
  nowTop,
  isToday,
  selectedEventKey,
  onSelectEvent,
}: {
  events: ScheduleEvent[]
  weekend: boolean
  nowTop: number | null
  isToday: boolean
  selectedEventKey?: string | null
  onSelectEvent?: (event: ScheduleEvent, anchor: HTMLElement) => void
}) {
  const positioned = useMemo(() => layoutDayEvents(events), [events])

  return (
    <div className={`relative flex-1 border-l border-main/60 ${weekend ? 'bg-zGray-800/25' : ''}`}>
      {positioned.map(({ event, lane, laneCount }) => {
        const top = (event.start.getHours() * 60 + event.start.getMinutes()) * MINUTE_HEIGHT
        const time = formatEventTime(event.start)
        const selected = event.key === selectedEventKey

        return (
          <button
            key={event.key}
            type="button"
            title={`${time} · ${event.name}`}
            onClick={(mouseEvent) => onSelectEvent?.(event, mouseEvent.currentTarget)}
            className={`absolute z-[1] truncate rounded-[4px] px-1.5 text-left text-[11px] leading-[19px] hover:brightness-110 ${selected ? 'z-[2] ring-1 ring-current' : ''} ${eventChipClasses(event.triggerId, event.enabled)}`}
            style={{
              top,
              height: SLOT_MINUTES * MINUTE_HEIGHT - 2,
              left: `calc(${String((lane / laneCount) * 100)}% + 2px)`,
              width: `calc(${String(100 / laneCount)}% - 4px)`,
            }}
          >
            {event.kind === 'webhook' ? (
              // A received webhook leads with its icon and name — the arrival
              // time is where the chip sits; the tooltip and popup spell it out.
              <>
                <Webhook className="inline h-3 w-3 align-[-2px]" strokeWidth={2} /> {event.name}
              </>
            ) : (
              <>
                <span className="font-medium">{time}</span> {event.name}
              </>
            )}
          </button>
        )
      })}
      {nowTop !== null &&
        (isToday ? (
          <div className="pointer-events-none absolute inset-x-0 z-10" style={{ top: nowTop }}>
            <div className="absolute -left-px -top-[3px] h-[7px] w-[7px] rounded-full bg-zOrangered-500" />
            <div className="h-px bg-zOrangered-500" />
          </div>
        ) : (
          <div
            className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-zOrangered-500/45"
            style={{ top: nowTop }}
          />
        ))}
    </div>
  )
}
