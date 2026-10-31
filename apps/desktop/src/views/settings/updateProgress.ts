import { formatBytes } from '../cloud/shared.ts'

/** Percent, size and speed of an update download; null until the size is known. */
export function updateProgress(download: {
  transferred: number
  total: number
  bytesPerSecond: number
}): { percent: number; done: string; total: string; speed: string } | null {
  if (download.total <= 0) return null

  return {
    percent: Math.min(100, Math.floor((download.transferred / download.total) * 100)),
    done: formatBytes(download.transferred),
    total: formatBytes(download.total),
    speed: formatBytes(download.bytesPerSecond),
  }
}
