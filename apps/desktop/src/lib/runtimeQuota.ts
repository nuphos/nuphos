import type { RuntimeQuota, RuntimeQuotaWindow } from '../types/runtime'

export type QuotaTone = 'ok' | 'warning' | 'exhausted'

export function mostConstrainedWindow(quota: RuntimeQuota | undefined): RuntimeQuotaWindow | null {
  if (!quota?.available || quota.windows.length === 0) return null

  let worst = quota.windows[0]

  for (const window of quota.windows) if (window.usedPercent > worst.usedPercent) worst = window

  return worst
}

export function quotaTone(quota: RuntimeQuota | undefined): QuotaTone {
  const worst = mostConstrainedWindow(quota)

  if (!worst) return 'ok'
  if (worst.usedPercent >= 100) return 'exhausted'

  return worst.usedPercent >= 80 ? 'warning' : 'ok'
}

/** With no figure to show, the agent's own reason is the whole answer. */
export function quotaNote(quota: RuntimeQuota | undefined): string | null {
  if (!quota || quota.available) return null

  return quota.reason ?? null
}

export function quotaSummary(quota: RuntimeQuota | undefined): string | null {
  const worst = mostConstrainedWindow(quota)

  if (!worst) return null

  return `${String(Math.max(0, Math.floor(100 - worst.usedPercent)))}% left`
}

function formatClock(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function formatWeekday(date: Date): string {
  return date.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

export function formatResetsAt(resetsAt: string | null, now: Date): string | null {
  if (!resetsAt) return null
  const at = new Date(resetsAt)

  if (Number.isNaN(at.getTime())) return null
  const deltaMinutes = Math.round((at.getTime() - now.getTime()) / 60_000)

  if (deltaMinutes <= 0) return 'resets now'
  if (deltaMinutes >= 24 * 60) return `resets ${formatWeekday(at)}`
  const hours = Math.floor(deltaMinutes / 60)
  const minutes = deltaMinutes % 60
  const relative = hours > 0 ? `${String(hours)}h ${String(minutes)}m` : `${String(minutes)}m`

  return `resets in ${relative} (${formatClock(at)})`
}

export function quotaWindowLine(window: RuntimeQuotaWindow, now: Date): string {
  const reset = formatResetsAt(window.resetsAt, now)
  const used = `${window.label}: ${String(Math.round(window.usedPercent))}% used`

  return reset ? `${used} · ${reset}` : used
}

export function quotaDetailLines(
  quota: RuntimeQuota | undefined,
  now: Date = new Date(),
): string[] {
  if (!quota?.available) return []

  return quota.windows.map((window) => quotaWindowLine(window, now))
}
