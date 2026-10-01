import { CalendarDays } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'

import { EmptyState } from '../../../components/EmptyState'
import { useResetOnKey } from '../../useResetOnKey'

import { EventPopover } from './EventPopover'
import { addDays, monthViewStartWeek, startOfDay, startOfWeek, titleForView } from './model'
import { MonthStrip } from './MonthStrip'
import { ScheduleHeader } from './ScheduleHeader'
import { TimeGrid } from './TimeGrid'
import { useWebhookRuns } from './useWebhookRuns'

import type { SelectedEvent } from './EventPopover'
import type { ScheduleViewMode } from './model'
import type { MonthStripHandle } from './MonthStrip'
import type { TimeGridHandle } from './TimeGrid'
import type { AgentTrigger } from '../../../api'
import type { ComponentProps } from 'react'

// Which view the user last chose — a personal habit, like the sidebar prefs.
const VIEW_MODE_STORAGE_KEY = 'nuphos.scheduleViewMode'

function loadViewMode(): ScheduleViewMode {
  try {
    const stored = localStorage.getItem(VIEW_MODE_STORAGE_KEY)

    if (stored === 'day' || stored === 'week' || stored === 'month') return stored
  } catch {
    // Storage unavailable — fall through to the default.
  }

  return 'week'
}

type Props = {
  teamId: string
  triggers: AgentTrigger[]
  loading: boolean
  refreshKey?: number
  /** The empty state's call to action. */
  emptyAction?: ComponentProps<typeof EmptyState>['primaryAction']
  /** Open one trigger's detail — the popup's jump-out. */
  onOpenTrigger?: (triggerId: string, triggerName: string) => void
}

/**
 * When the agent runs: every cron trigger's fire times, laid out on a
 * Day/Week/Month schedule (disabled triggers render hollow), with received
 * webhook runs overlaid. Read-only — clicking an occurrence opens a detail
 * popup anchored to it. Trackpad swipes track the finger, iOS-Calendar-style:
 * the Day/Week grids slide their day columns under a fixed hour gutter and
 * snap in single-day steps; the Month grid slides its week rows vertically and
 * snaps one row at a time.
 */
export function TriggerCalendar({
  teamId,
  triggers,
  loading,
  refreshKey,
  emptyAction,
  onOpenTrigger,
}: Props) {
  const [mode, setMode] = useState<ScheduleViewMode>(loadViewMode)
  // The anchor is the window's first visible unit: any day for Day view, any
  // 7-day span's first day for Week, the first week row's Sunday for Month —
  // free-scrolled, not snapped, because every grid pages in single steps.
  const [anchor, setAnchor] = useState(() => {
    const initialMode = loadViewMode()

    if (initialMode === 'month') return monthViewStartWeek(new Date())

    return initialMode === 'week' ? startOfWeek(new Date()) : startOfDay(new Date())
  })
  const [selected, setSelected] = useState<SelectedEvent | null>(null)
  // The time grid's vertical scroll offset survives mode switches.
  const timeScrollRef = useRef<number | null>(null)
  const timeGridRef = useRef<TimeGridHandle>(null)
  const monthStripRef = useRef<MonthStripHandle>(null)

  useResetOnKey(`${teamId}|${String(refreshKey)}`, () => setSelected(null))

  const cronTriggers = useMemo(
    () => triggers.filter((trigger) => trigger.triggerType === 'cron' && trigger.cronExpression),
    [triggers],
  )
  // Received webhook events overlay the cron projections on every grid.
  const runEvents = useWebhookRuns(teamId, triggers, refreshKey)

  const shift = (direction: 1 | -1) => {
    if (mode === 'month') monthStripRef.current?.page(direction)
    else timeGridRef.current?.page(direction)
  }
  const goToday = () => {
    setSelected(null)
    if (mode === 'month') setAnchor(monthViewStartWeek(new Date()))
    else setAnchor(mode === 'week' ? startOfWeek(new Date()) : startOfDay(new Date()))
  }
  const changeMode = (next: ScheduleViewMode) => {
    setSelected(null)
    // Entering a mode realigns the free-scrolled window: Week to the anchor's
    // week, Month to the week row holding the anchor month's 1st.
    if (next === 'week') setAnchor((current) => startOfWeek(current))
    if (next === 'month') setAnchor((current) => monthViewStartWeek(current))
    setMode(next)
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, next)
    } catch {
      // Best-effort persistence only.
    }
  }
  const selectEvent = (event: SelectedEvent['event'], anchorEl: HTMLElement) =>
    setSelected({ event, anchor: anchorEl })

  if (!loading && cronTriggers.length === 0 && runEvents.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="Schedule"
        description="Scheduled agent runs show up here. Create a cron trigger and every upcoming run lands on this calendar."
        primaryAction={emptyAction}
      />
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScheduleHeader
        title={titleForView(mode, anchor)}
        mode={mode}
        onChangeMode={changeMode}
        onToday={goToday}
        onShift={shift}
      />
      {mode === 'month' ? (
        <MonthStrip
          ref={monthStripRef}
          startWeek={anchor}
          triggers={cronTriggers}
          runEvents={runEvents}
          selectedEventKey={selected?.event.key}
          onSelectEvent={selectEvent}
          onCommitWeeks={(deltaWeeks) => setAnchor((current) => addDays(current, deltaWeeks * 7))}
          onGestureStart={() => setSelected(null)}
        />
      ) : (
        <div className="min-h-0 flex-1">
          <TimeGrid
            ref={timeGridRef}
            startDay={anchor}
            visibleDays={mode === 'day' ? 1 : 7}
            triggers={cronTriggers}
            runEvents={runEvents}
            selectedEventKey={selected?.event.key}
            onSelectEvent={selectEvent}
            onCommitDays={(deltaDays) => setAnchor((current) => addDays(current, deltaDays))}
            onGestureStart={() => setSelected(null)}
            scrollStateRef={timeScrollRef}
          />
        </div>
      )}
      {selected && (
        <EventPopover
          selected={selected}
          trigger={triggers.find((trigger) => trigger.id === selected.event.triggerId)}
          onClose={() => setSelected(null)}
          onOpenTrigger={onOpenTrigger}
        />
      )}
    </div>
  )
}
