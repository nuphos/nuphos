import { t } from '../../i18n/index.ts'

const GAP_MS = 15 * 60_000
const DAY_MS = 86_400_000

const startOfDay = (ms: number) => new Date(ms).setHours(0, 0, 0, 0)

/** As in iMessage: a post that starts a new day or follows a 15-minute pause gets a time above it. */
export function startsTimeGap(at: number, previous: number | undefined): boolean {
  if (!at) return false
  if (!previous) return true

  return at - previous > GAP_MS || startOfDay(at) > startOfDay(previous)
}

/** "Today 13:05", "Yesterday 09:12", the weekday within a week, otherwise the date. */
export function timeGapLabel(at: number, now = Date.now()): string {
  const d = new Date(at)
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS)

  if (days === 0) return t('Today {time}', { time })
  if (days === 1) return t('Yesterday {time}', { time })
  const day = d.toLocaleDateString(
    [],
    days > 1 && days < 7
      ? { weekday: 'long' }
      : {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          ...(d.getFullYear() === new Date(now).getFullYear() ? {} : { year: 'numeric' }),
        },
  )

  return `${day} ${time}`
}

/** The exact time, for a post's hover tooltip. */
export const exactTime = (at: number) =>
  at ? new Date(at).toLocaleString([], { dateStyle: 'full', timeStyle: 'short' }) : undefined

/**
 * Only a post sent after the chat opened springs in. Whatever the opening read
 * brings, even one that lands after a stale copy showed, was already there.
 */
export const sentSinceOpening = (at: number, openedAt: number) => at > openedAt
