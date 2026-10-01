import { motion } from 'framer-motion'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'

import { addDays, dayKey, formatEventTime, hourLabel, sameDay } from './model'
import { buildScheduleEvents, sortEvents } from './occurrences'
import {
  GRID_HEIGHT,
  HOUR_HEIGHT,
  isWeekend,
  MINUTE_HEIGHT,
  useNow,
  useScrollbarInset,
} from './timeGridMeta'
import { DayColumn, DayHeaderCell } from './timeGridParts'
import { useStripPager } from './useStripPager'

import type { ScheduleEvent } from './model'
import type { AgentTrigger } from '../../../api'

const HOURS = Array.from({ length: 23 }, (_, i) => i + 1)

export type TimeGridHandle = {
  /** Animated full-page turn (±visibleDays days) — the header arrows. */
  page: (direction: 1 | -1) => void
}

type Props = {
  /** First visible day column. */
  startDay: Date
  /** Window width: 1 for Day view, 7 for Week view. */
  visibleDays: 1 | 7
  triggers: AgentTrigger[]
  /** Already-received webhook events (any range); the grid keeps the ones
   *  inside its rendered days. */
  runEvents?: ScheduleEvent[]
  selectedEventKey?: string | null
  onSelectEvent?: (event: ScheduleEvent, anchor: HTMLElement) => void
  /** Apply a day-stepped window shift once a swipe/page snap completes. */
  onCommitDays: (deltaDays: number) => void
  /** A drag or page just started — close the event popup and the like. */
  onGestureStart?: () => void
  /** Vertical scroll offset, shared across mode switches (see the effect). */
  scrollStateRef?: React.RefObject<number | null>
}

/**
 * The Day/Week time grid, iOS-Calendar-style: the hour gutter stays fixed
 * while the day columns ride a horizontal strip that tracks trackpad swipes
 * live and snaps to whole days — a week view pages a week with the arrows but
 * steps any number of days by hand. A buffer page of columns on either side
 * keeps pixels under the strip mid-drag.
 */
export const TimeGrid = forwardRef<TimeGridHandle, Props>(function TimeGrid(
  {
    startDay,
    visibleDays,
    triggers,
    runEvents,
    selectedEventKey,
    onSelectEvent,
    onCommitDays,
    onGestureStart,
    scrollStateRef,
  },
  ref,
) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const now = useNow()
  // A classic vertical scrollbar narrows the scroll container's content box,
  // and the day columns with it — pad the header (which lives outside the
  // scroll container) to match, or every column boundary skews.
  const scrollbarInset = useScrollbarInset(scrollRef)
  const buffer = visibleDays
  const totalDays = visibleDays + 2 * buffer
  const renderedDays = useMemo(
    () => Array.from({ length: totalDays }, (_, i) => addDays(startDay, i - buffer)),
    [startDay, totalDays, buffer],
  )
  const events = useMemo(() => {
    const rangeStart = renderedDays[0]
    const rangeEnd = addDays(renderedDays[totalDays - 1], 1)
    const inRange = (runEvents ?? []).filter(
      (event) => event.start >= rangeStart && event.start < rangeEnd,
    )

    return sortEvents([...buildScheduleEvents(triggers, rangeStart, rangeEnd), ...inRange])
  }, [triggers, runEvents, renderedDays, totalDays])
  const eventsByDay = useMemo(() => {
    const byDay = new Map<string, ScheduleEvent[]>()

    for (const event of events) {
      const key = dayKey(event.start)
      const list = byDay.get(key)

      if (list) list.push(event)
      else byDay.set(key, [event])
    }

    return byDay
  }, [events])

  const strip = useStripPager({
    axis: 'x',
    viewportRef,
    visibleUnits: visibleDays,
    maxUnits: buffer,
    onCommit: onCommitDays,
    onGestureStart,
  })

  useImperativeHandle(ref, () => ({
    page: (direction) => strip.slideBy(direction * visibleDays),
  }))

  useEffect(() => {
    // A saved offset (mode switches, day snaps) wins; otherwise open on the
    // working morning rather than midnight, following the clock when today is
    // on screen. Reads the clock directly: depending on the ticking `now`
    // would re-scroll every 30s and fight the user's own scrolling.
    const saved = scrollStateRef?.current

    if (saved != null) {
      scrollRef.current?.scrollTo({ top: saved })

      return
    }
    const current = new Date()
    const showsToday = renderedDays.some((day) => sameDay(day, current))
    const anchorMinutes = showsToday ? current.getHours() * 60 + current.getMinutes() - 90 : 8 * 60

    scrollRef.current?.scrollTo({ top: Math.max(0, anchorMinutes * MINUTE_HEIGHT) })
  }, [renderedDays, scrollStateRef])

  const nowTop = (now.getHours() * 60 + now.getMinutes()) * MINUTE_HEIGHT
  const windowDays = renderedDays.slice(buffer, buffer + visibleDays)
  const showsToday = windowDays.some((day) => sameDay(day, now))
  // The strip is `totalDays / visibleDays` viewports wide, pulled left so the
  // buffer sits offscreen; the motion value adds the live drag on top.
  const stripStyle = {
    width: `${String((totalDays / visibleDays) * 100)}%`,
    left: `${String((-buffer / visibleDays) * 100)}%`,
  }

  return (
    <div className="flex h-full min-h-0 flex-col" onWheel={strip.onWheel}>
      <div className="flex border-b border-main" style={{ paddingRight: scrollbarInset }}>
        <div className="w-14 shrink-0" />
        <div className="relative min-w-0 flex-1 overflow-hidden">
          <motion.div className="relative flex" style={{ ...stripStyle, x: strip.offset }}>
            {renderedDays.map((day) => (
              <DayHeaderCell key={dayKey(day)} day={day} now={now} />
            ))}
          </motion.div>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(event) => {
          if (scrollStateRef) scrollStateRef.current = event.currentTarget.scrollTop
        }}
      >
        <div className="relative flex" style={{ height: GRID_HEIGHT }}>
          <div className="pointer-events-none absolute inset-y-0 left-14 right-0">
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="absolute inset-x-0 border-t border-main/50"
                style={{ top: hour * HOUR_HEIGHT }}
              />
            ))}
          </div>

          <div className="relative z-10 w-14 shrink-0">
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="absolute right-2 -translate-y-1/2 text-[10.5px] text-tertiary"
                style={{ top: hour * HOUR_HEIGHT }}
              >
                {hourLabel(hour)}
              </div>
            ))}
            {showsToday && (
              <div
                className="absolute right-1 -translate-y-1/2 rounded bg-zOrangered-500 px-1 py-px text-[10px] font-medium text-white"
                style={{ top: nowTop }}
              >
                {formatEventTime(now)}
              </div>
            )}
          </div>

          <div ref={viewportRef} className="relative min-w-0 flex-1 overflow-hidden">
            <motion.div className="relative flex h-full" style={{ ...stripStyle, x: strip.offset }}>
              {renderedDays.map((day) => (
                <DayColumn
                  key={dayKey(day)}
                  events={eventsByDay.get(dayKey(day)) ?? []}
                  weekend={isWeekend(day)}
                  // When today is in the visible window the whole strip carries
                  // the now line, Notion-style: solid on today, dashed as a
                  // faint echo on the sibling days.
                  nowTop={showsToday ? nowTop : null}
                  isToday={sameDay(day, now)}
                  selectedEventKey={selectedEventKey}
                  onSelectEvent={onSelectEvent}
                />
              ))}
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  )
})
