import { motion } from 'framer-motion'
import { Webhook } from 'lucide-react'
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react'

import {
  addDays,
  dayKey,
  eventChipClasses,
  formatEventTime,
  MONTH_VISIBLE_WEEKS,
  monthViewFocusDate,
  monthViewStartWeek,
  sameDay,
} from './model'
import { buildScheduleEvents, sortEvents } from './occurrences'
import { isWeekend } from './timeGridMeta'
import { useStripPager } from './useStripPager'

import type { ScheduleEvent } from './model'
import type { AgentTrigger } from '../../../api'

const WEEKDAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_SHORT = new Intl.DateTimeFormat('en-US', { month: 'short' })
// Fixed chip budget per cell; the tail collapses into "+N more". Room enough
// for the common case without letting an hourly trigger flood the row.
const MAX_CHIPS_PER_DAY = 3
// Rendered rows beyond the window on each side. Six covers the arrows' whole-
// month slide (a month is at most six rows away) and any one drag.
const BUFFER_WEEKS = 6

export type MonthStripHandle = {
  /** Animated whole-month turn (to the week of the ±1 month's 1st) — arrows. */
  page: (direction: 1 | -1) => void
}

type Props = {
  /** First visible week row (a Sunday). */
  startWeek: Date
  triggers: AgentTrigger[]
  /** Already-received webhook events (any range); the strip keeps the ones
   *  inside its rendered weeks. */
  runEvents?: ScheduleEvent[]
  selectedEventKey?: string | null
  onSelectEvent?: (event: ScheduleEvent, anchor: HTMLElement) => void
  /** Apply a row-stepped window shift once a swipe/page snap completes. */
  onCommitWeeks: (deltaWeeks: number) => void
  /** A drag or page just started — close the event popup and the like. */
  onGestureStart?: () => void
}

/**
 * The Month view, iOS-Calendar-style: a fixed weekday header over a vertical
 * strip of week rows that tracks trackpad swipes live and snaps one row at a
 * time — the arrows still page a whole month, by sliding to the week of the
 * next month's 1st. Out-of-focus-month days dim; the focus month is whatever
 * sits under the middle of the window (see monthViewFocusDate).
 */
export const MonthStrip = forwardRef<MonthStripHandle, Props>(function MonthStrip(
  {
    startWeek,
    triggers,
    runEvents,
    selectedEventKey,
    onSelectEvent,
    onCommitWeeks,
    onGestureStart,
  },
  ref,
) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const totalWeeks = MONTH_VISIBLE_WEEKS + 2 * BUFFER_WEEKS
  const renderedWeeks = useMemo(
    () => Array.from({ length: totalWeeks }, (_, i) => addDays(startWeek, (i - BUFFER_WEEKS) * 7)),
    [startWeek, totalWeeks],
  )
  const eventsByDay = useMemo(() => {
    const rangeStart = renderedWeeks[0]
    const rangeEnd = addDays(renderedWeeks[totalWeeks - 1], 7)
    const inRange = (runEvents ?? []).filter(
      (event) => event.start >= rangeStart && event.start < rangeEnd,
    )
    const events = sortEvents([...buildScheduleEvents(triggers, rangeStart, rangeEnd), ...inRange])
    const byDay = new Map<string, ScheduleEvent[]>()

    for (const event of events) {
      const key = dayKey(event.start)
      const list = byDay.get(key)

      if (list) list.push(event)
      else byDay.set(key, [event])
    }

    return byDay
  }, [triggers, runEvents, renderedWeeks, totalWeeks])

  const strip = useStripPager({
    axis: 'y',
    viewportRef,
    visibleUnits: MONTH_VISIBLE_WEEKS,
    maxUnits: BUFFER_WEEKS,
    onCommit: onCommitWeeks,
    onGestureStart,
  })

  const focus = monthViewFocusDate(startWeek)

  useImperativeHandle(ref, () => ({
    page: (direction) => {
      // The arrows jump months: slide to the week row holding the 1st of the
      // month before/after the focus month. Day-count division absorbs DST.
      const target = monthViewStartWeek(
        new Date(focus.getFullYear(), focus.getMonth() + direction, 1),
      )
      const deltaWeeks = Math.round(
        (target.getTime() - startWeek.getTime()) / (7 * 24 * 60 * 60 * 1000),
      )

      strip.slideBy(deltaWeeks)
    },
  }))

  const today = new Date()
  // The strip is `totalWeeks / MONTH_VISIBLE_WEEKS` viewports tall, pulled up
  // so the buffer sits offscreen; the motion value adds the live drag on top.
  const stripStyle = {
    height: `${String((totalWeeks / MONTH_VISIBLE_WEEKS) * 100)}%`,
    top: `${String((-BUFFER_WEEKS / MONTH_VISIBLE_WEEKS) * 100)}%`,
  }

  return (
    <div className="flex h-full min-h-0 flex-col" onWheel={strip.onWheel}>
      <div className="grid grid-cols-7 border-b border-main">
        {WEEKDAY_HEADERS.map((label) => (
          <div key={label} className="py-1.5 text-center text-[11px] text-tertiary">
            {label}
          </div>
        ))}
      </div>
      <div ref={viewportRef} className="relative min-h-0 flex-1 overflow-hidden">
        <motion.div className="relative flex flex-col" style={{ ...stripStyle, y: strip.offset }}>
          {renderedWeeks.map((weekStart) => (
            <div key={dayKey(weekStart)} className="grid min-h-0 flex-1 grid-cols-7">
              {Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((day, index) => (
                <MonthCell
                  key={dayKey(day)}
                  day={day}
                  inMonth={
                    day.getMonth() === focus.getMonth() && day.getFullYear() === focus.getFullYear()
                  }
                  isToday={sameDay(day, today)}
                  isFirstColumn={index === 0}
                  weekend={isWeekend(day)}
                  events={eventsByDay.get(dayKey(day)) ?? []}
                  selectedEventKey={selectedEventKey}
                  onSelectEvent={onSelectEvent}
                />
              ))}
            </div>
          ))}
        </motion.div>
      </div>
    </div>
  )
})

function MonthCell({
  day,
  inMonth,
  isToday,
  isFirstColumn,
  weekend,
  events,
  selectedEventKey,
  onSelectEvent,
}: {
  day: Date
  inMonth: boolean
  isToday: boolean
  isFirstColumn: boolean
  weekend: boolean
  events: ScheduleEvent[]
  selectedEventKey?: string | null
  onSelectEvent?: (event: ScheduleEvent, anchor: HTMLElement) => void
}) {
  const visible = events.slice(0, MAX_CHIPS_PER_DAY)
  const hidden = events.length - visible.length
  // The 1st carries its month name so week rows spanning two months stay
  // readable without glancing back at the title.
  const label = day.getDate() === 1 ? `${MONTH_SHORT.format(day)} 1` : String(day.getDate())

  return (
    <div
      className={`flex min-h-0 flex-col gap-0.5 overflow-hidden border-b border-main/60 p-1 ${isFirstColumn ? '' : 'border-l'} ${weekend ? 'bg-zGray-800/25' : ''}`}
    >
      <div className="flex justify-start px-0.5 text-[11.5px] leading-5">
        {isToday ? (
          <span className="rounded-[5px] bg-zOrangered-500 px-1 font-semibold text-white">
            {label}
          </span>
        ) : (
          <span className={inMonth ? 'font-medium text-secondary' : 'text-tertiary/70'}>
            {label}
          </span>
        )}
      </div>
      {visible.map((event) => {
        const time = formatEventTime(event.start)
        const selected = event.key === selectedEventKey

        return (
          <button
            key={event.key}
            type="button"
            title={`${time} · ${event.name}`}
            onClick={(mouseEvent) => onSelectEvent?.(event, mouseEvent.currentTarget)}
            className={`truncate rounded-[4px] px-1 text-left text-[11px] leading-[17px] hover:brightness-110 ${selected ? 'ring-1 ring-current' : ''} ${eventChipClasses(event.triggerId, event.enabled)}`}
          >
            {event.kind === 'webhook' ? (
              // A received webhook leads with its icon and name — the arrival
              // time is in the tooltip and popup.
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
      {hidden > 0 && <div className="px-1 text-[10.5px] text-tertiary">+{hidden} more</div>}
    </div>
  )
}
