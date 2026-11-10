import { lstat, readdir } from 'node:fs/promises'
import path from 'node:path'

import { reclaimSessionWorkspaces } from './disk-reclaim.ts'

/**
 * A directory is measured within this much time and this many entries; past either the
 * reading stops and says so. A workspace can hold a build tree with millions of files,
 * and a number in a log is not worth an app that stalls for it.
 */
export const DISK_MEASURE_DEADLINE_MS = 2_000
export const DISK_MEASURE_ENTRY_CAP = 100_000
/** The pass starts this long after the app is up, so no launch ever waits for a disk. */
export const DISK_MAINTENANCE_DELAY_MS = 20_000

const GIB = 1024 ** 3

export type DiskUsage = {
  bytes: number
  entries: number
  /** False when the deadline or the entry cap stopped the reading. */
  complete: boolean
}

export type MeasureOptions = {
  deadlineMs?: number
  entryCap?: number
  now?: () => number
}

/**
 * What a directory holds. Links and junctions are never followed, so a link into a whole
 * disk costs nothing; an unreadable entry is counted and skipped, never thrown.
 */
export async function measureDirectory(
  dir: string,
  options: MeasureOptions = {},
): Promise<DiskUsage> {
  const clock = options.now ?? Date.now
  const deadline = clock() + (options.deadlineMs ?? DISK_MEASURE_DEADLINE_MS)
  const cap = options.entryCap ?? DISK_MEASURE_ENTRY_CAP
  const stack = [dir]
  let bytes = 0
  let entries = 0

  while (stack.length > 0) {
    if (entries >= cap || clock() > deadline) return { bytes, entries, complete: false }
    const at = stack.pop() ?? ''
    const stat = await lstat(at).catch(() => null)

    if (stat === null) continue
    entries += 1
    if (stat.isDirectory()) {
      // `lstat` never calls a link or a junction a directory, so nothing is followed.
      const names = await readdir(at).catch(() => [])

      stack.push(...names.map((name) => path.join(at, name)))
      continue
    }
    if (stat.isFile()) bytes += stat.size
  }

  return { bytes, entries, complete: true }
}

export type DiskMaintenance = {
  /** The workspaces this computer's agents use right now, as the controller sees them. */
  workspaces: () => string[]
  /** Whether a live session is using a directory. Nothing is reclaimed without this. */
  inUse: (dir: string) => boolean | Promise<boolean>
  /** A data directory this build does not use. It is reported, never deleted. */
  leftAlone: string | null
  log?: (message: string, data?: Record<string, unknown>) => void
}

/**
 * One quiet pass: reclaim the session workspaces a finished session left behind, and
 * report what a person would otherwise never see. Nothing here throws: every failure is
 * logged and the pass carries on, because it runs beside a live app.
 */
export async function runDiskMaintenance(maintenance: DiskMaintenance): Promise<void> {
  const { log } = maintenance

  for (const workspace of maintenance.workspaces()) {
    try {
      const reclaimed = await reclaimSessionWorkspaces(workspace, {
        inUse: maintenance.inUse,
        log,
      })
      const usage = await measureDirectory(workspace)

      log?.('local runtime: workspace', {
        workspace,
        reclaimed: reclaimed.length,
        ...summary(usage),
      })
    } catch (error) {
      log?.('local runtime: workspace maintenance failed', { workspace, error: String(error) })
    }
  }
  // Reported only. It holds an older install's own data, and whether its owner is
  // finished with it is theirs to say, not something this pass may guess.
  if (maintenance.leftAlone !== null) {
    try {
      const usage = await measureDirectory(maintenance.leftAlone)

      log?.('local runtime: unused data directory', {
        dir: maintenance.leftAlone,
        ...summary(usage),
      })
    } catch (error) {
      log?.('local runtime: unused data directory could not be read', { error: String(error) })
    }
  }
}

/** Runs the pass once, on its own, and returns a cancel. Never holds the app open. */
export function startDiskMaintenance(
  maintenance: DiskMaintenance,
  delayMs = DISK_MAINTENANCE_DELAY_MS,
): () => void {
  const timer = setTimeout(() => {
    void runDiskMaintenance(maintenance).catch((error: unknown) => {
      maintenance.log?.('local runtime: disk maintenance failed', { error: String(error) })
    })
  }, delayMs)

  timer.unref()

  return () => clearTimeout(timer)
}

/** The reading, with the size a person can read beside the exact count. */
function summary(usage: DiskUsage) {
  return {
    bytes: usage.bytes,
    gib: Math.round((usage.bytes / GIB) * 10) / 10,
    entries: usage.entries,
    complete: usage.complete,
  }
}
