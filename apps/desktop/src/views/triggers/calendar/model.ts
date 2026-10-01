// ────────────────────── Schedule model & date math ──────────────────────
// The schedule shows when the team's cron triggers fire. Occurrences are
// expanded client-side (see occurrences.ts); everything here is plain date
// arithmetic shared by the Day/Week/Month grids.

export type ScheduleViewMode = 'day' | 'week' | 'month'

export type ScheduleEvent = {
  /** Unique per rendered occurrence — `${triggerId}@${start ms}` for cron
   *  expansions, `run:${sessionId}` for received webhook events. */
  key: string
  triggerId: string
  name: string
  start: Date
  /** Disabled triggers still render (dashed outline) — they won't fire, but
   *  the schedule they'd follow stays visible. */
  enabled: boolean
  /** `cron` = a projected fire time; `webhook` = a request that actually
   *  arrived (chips lead with a webhook icon to tell the two apart). */
  kind: 'cron' | 'webhook'
}

export const SCHEDULE_VIEW_MODES: { value: ScheduleViewMode; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
]

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

/** Weeks start on Sunday, matching the reference layout and `WEEKDAYS` cron UI. */
export function startOfWeek(date: Date): Date {
  return addDays(startOfDay(date), -date.getDay())
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function dayKey(date: Date): string {
  return `${String(date.getFullYear())}-${String(date.getMonth())}-${String(date.getDate())}`
}

/**
 * The Month view is a continuous strip of week rows (it pages one row at a
 * time, iOS-style), always showing this many rows. Six rows cover any month
 * entered at the week of its 1st, with context after it.
 */
export const MONTH_VISIBLE_WEEKS = 6

/**
 * Which month a Month window "is": the month under the middle of the visible
 * rows. Drives the title and the dimming of out-of-month days as the strip
 * rolls row by row through month boundaries.
 */
export function monthViewFocusDate(startWeek: Date): Date {
  return addDays(startOfWeek(startWeek), Math.floor((MONTH_VISIBLE_WEEKS * 7) / 2))
}

/** The Month view's entry point for a date: the week row holding its 1st. */
export function monthViewStartWeek(date: Date): Date {
  return startOfWeek(new Date(date.getFullYear(), date.getMonth(), 1))
}

const MONTH_YEAR = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' })
const MONTH_SHORT = new Intl.DateTimeFormat('en-US', { month: 'short' })
const FULL_DAY = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
})

export function titleForView(mode: ScheduleViewMode, anchor: Date): string {
  if (mode === 'day') return FULL_DAY.format(anchor)
  // The Month title names the window's focus month, not the anchor row's.
  if (mode === 'month') return MONTH_YEAR.format(monthViewFocusDate(anchor))
  // The week window is anchored to its own first day (day-stepped paging).
  const start = startOfDay(anchor)
  const end = addDays(start, 6)

  if (start.getMonth() === end.getMonth()) return MONTH_YEAR.format(start)

  return `${MONTH_SHORT.format(start)} – ${MONTH_SHORT.format(end)} ${String(end.getFullYear())}`
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

export function formatEventTime(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/** Time-grid gutter labels: "1 AM" … "11 PM" (midnight row carries no label). */
export function hourLabel(hour: number): string {
  if (hour === 0) return '12 AM'
  if (hour < 12) return `${String(hour)} AM`
  if (hour === 12) return '12 PM'

  return `${String(hour - 12)} PM`
}

// ────────────────────── Event colors ──────────────────────
// One stable hue per trigger so the same job reads as the same color across
// views and days. Mid-tone text over a faint tint works on both themes (the
// same convention as the status pills elsewhere in the app). `dot` is the
// solid swatch the detail popup leads with.
const EVENT_COLORS: { tint: string; text: string; border: string; dot: string }[] = [
  { tint: 'bg-sky-500/15', text: 'text-sky-400', border: 'border-sky-400', dot: 'bg-sky-400' },
  {
    tint: 'bg-emerald-500/15',
    text: 'text-emerald-400',
    border: 'border-emerald-400',
    dot: 'bg-emerald-400',
  },
  {
    tint: 'bg-violet-500/15',
    text: 'text-violet-400',
    border: 'border-violet-400',
    dot: 'bg-violet-400',
  },
  {
    tint: 'bg-amber-500/15',
    text: 'text-amber-400',
    border: 'border-amber-400',
    dot: 'bg-amber-400',
  },
  { tint: 'bg-rose-500/15', text: 'text-rose-400', border: 'border-rose-400', dot: 'bg-rose-400' },
  { tint: 'bg-cyan-500/15', text: 'text-cyan-400', border: 'border-cyan-400', dot: 'bg-cyan-400' },
  {
    tint: 'bg-orange-500/15',
    text: 'text-orange-400',
    border: 'border-orange-400',
    dot: 'bg-orange-400',
  },
  { tint: 'bg-teal-500/15', text: 'text-teal-400', border: 'border-teal-400', dot: 'bg-teal-400' },
]

function colorFor(triggerId: string): (typeof EVENT_COLORS)[number] {
  let hash = 0

  for (let i = 0; i < triggerId.length; i++) {
    hash = (hash * 31 + triggerId.charCodeAt(i)) >>> 0
  }

  return EVENT_COLORS[hash % EVENT_COLORS.length]
}

/**
 * Chip classes for one occurrence. An enabled trigger gets the filled tint;
 * a disabled one keeps its hue but renders hollow — dashed outline over a
 * transparent background — so "won't fire" is visible at a glance.
 */
export function eventChipClasses(triggerId: string, enabled: boolean): string {
  const color = colorFor(triggerId)

  if (!enabled) return `border border-dashed bg-transparent ${color.text} ${color.border}`

  return `${color.tint} ${color.text}`
}

/** The popup's leading swatch — hollow for a paused trigger, like its chips. */
export function eventDotClasses(triggerId: string, enabled: boolean): string {
  const color = colorFor(triggerId)

  if (!enabled) return `border border-dashed bg-transparent ${color.border}`

  return color.dot
}
