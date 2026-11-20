import { readLocalStorage, writeLocalStorage } from '../../../app/localStorage.ts'

/**
 * A disk warning the person has put away. The warning is about their own computer and only
 * they can act on it, so Dismiss quiets it rather than hides it: it comes back when the day
 * is up, or sooner once the disk has climbed past what they dismissed.
 */
export type DiskSnooze = { until: number; percent: number }

/** How long Dismiss quiets a computer's warning. */
const SNOOZE_MS = 24 * 60 * 60 * 1000
/** Points of disk use past the dismissed reading that bring the warning back early. */
const WORSE_BY = 3
const KEY = 'nuphos.diskSnooze'

/** Whether a dismissal still covers this reading. */
export function covers(snooze: DiskSnooze | undefined, percent: number, now: number): boolean {
  if (!snooze) return false

  return now < snooze.until && percent < snooze.percent + WORSE_BY
}

/** What Dismiss records for a computer reading this full. */
export function dismissal(percent: number, now: number): DiskSnooze {
  return { until: now + SNOOZE_MS, percent }
}

function valid(value: unknown): value is DiskSnooze {
  if (!value || typeof value !== 'object') return false
  const { until, percent } = value as Partial<DiskSnooze>

  return (
    typeof until === 'number' &&
    Number.isFinite(until) &&
    typeof percent === 'number' &&
    Number.isFinite(percent)
  )
}

let revision = 0
const listeners = new Set<() => void>()

/** Read the shared store each time so other windows cannot leave a stale cache. */
function all(): Record<string, DiskSnooze> {
  const kept: Record<string, DiskSnooze> = {}
  try {
    const raw = readLocalStorage(KEY)
    const stored: unknown = raw ? JSON.parse(raw) : null

    if (stored && typeof stored === 'object')
      for (const [deviceId, snooze] of Object.entries(stored))
        if (valid(snooze)) kept[deviceId] = snooze
  } catch {
    // A disk warning is not worth failing a render over: an unreadable store is no snooze.
  }

  return kept
}

/** Whether this computer's warning is still put away at this reading. */
export function diskSnoozed(deviceId: string, percent: number, now = Date.now()): boolean {
  return covers(all()[deviceId], percent, now)
}

/** Puts this computer's warning away, in every chat and across restarts. */
export function dismissDisk(deviceId: string, percent: number, now = Date.now()) {
  const next = { ...all(), [deviceId]: dismissal(percent, now) }

  revision += 1
  writeLocalStorage(KEY, JSON.stringify(next))
  for (const listener of listeners) listener()
}

export function subscribeDiskSnooze(listener: () => void) {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY && event.key !== null) return
    revision += 1
    listener()
  }
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)

  return () => {
    listeners.delete(listener)
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
  }
}

export const diskSnoozeRevision = () => revision
