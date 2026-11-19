import { t } from '../i18n/index.ts'

import type { RuntimeQuota, RuntimeQuotaWindow } from '../types/runtime'

export type QuotaTone = 'ok' | 'warning' | 'exhausted'

export function mostConstrainedWindow(quota: RuntimeQuota | undefined): RuntimeQuotaWindow | null {
  if (!quota?.available || quota.windows.length === 0) return null

  let worst = quota.windows[0]

  for (const window of quota.windows) if (window.usedPercent > worst.usedPercent) worst = window

  return worst
}

export function quotaWindowTone(window: RuntimeQuotaWindow): QuotaTone {
  if (window.usedPercent >= 100) return 'exhausted'

  return window.usedPercent >= 80 ? 'warning' : 'ok'
}

export function quotaTone(quota: RuntimeQuota | undefined): QuotaTone {
  const worst = mostConstrainedWindow(quota)

  return worst ? quotaWindowTone(worst) : 'ok'
}

/** With no figure to show, the agent's own reason is the whole answer. */
export function quotaNote(quota: RuntimeQuota | undefined): string | null {
  if (!quota || quota.available) return null

  return quota.reason ?? null
}

/** The usage probe found no sign-in on the agent (the Agents page shows it as the
 *  Usage stat). Turns there fail until it is signed in again. A self-hosted agent
 *  signed in through `CLAUDE_CODE_OAUTH_TOKEN` reads the same, so this warns and
 *  never blocks. The reason is produced by the backend's runtime-quota-probe.ts. */
export function quotaSignedOut(quota: RuntimeQuota | undefined): boolean {
  return quota?.available === false && quota.reason === 'Sign in required'
}

/** Says which agents spend the same account, so moving to one of them gets past nothing. */
export function quotaSharedWith(quota: RuntimeQuota | undefined): string | null {
  const labels = quota?.sharesQuotaWith?.map(({ label }) => label)

  return labels?.length ? t('Shares quota with {name}', { name: labels.join(', ') }) : null
}

/** What is still unspent, floored so a nearly empty window never reads as more than it has. */
export function quotaLeftPercent(window: RuntimeQuotaWindow): number {
  return Math.max(0, Math.min(100, Math.floor(100 - window.usedPercent)))
}

export function quotaSummary(quota: RuntimeQuota | undefined): string | null {
  const worst = mostConstrainedWindow(quota)

  if (!worst) return null

  return t('{percent}% left', { percent: quotaLeftPercent(worst) })
}

/** "resets in 2d 5h", "resets in 3h 20m" or "resets in 12m"; nothing when the
 *  reset is unknown or already past. Every usage bar and usage-limit notice uses it. */
export function formatResetsIn(
  resetsAt: string | null | undefined,
  now: Date = new Date(),
): string | null {
  const ms = Date.parse(resetsAt ?? '') - now.getTime()

  // NaN, for an unknown or unreadable time, fails this as well as a past one.
  if (Number.isNaN(ms) || ms <= 0) return null
  const total = Math.ceil(ms / 60_000)
  const days = Math.floor(total / 1440)
  const hours = Math.floor((total % 1440) / 60)
  const minutes = total % 60
  let time = t('{minutes}m', { minutes })

  if (days > 0) time = t('{days}d {hours}h', { days, hours })
  else if (hours > 0) time = t('{hours}h {minutes}m', { hours, minutes })

  return t('resets in {time}', { time })
}

export function quotaWindowLine(window: RuntimeQuotaWindow, now: Date): string {
  const reset = formatResetsIn(window.resetsAt, now)
  const left = t('{name}: {percent}% left', {
    name: window.label,
    percent: quotaLeftPercent(window),
  })

  return reset ? `${left} · ${reset}` : left
}

export function quotaDetailLines(
  quota: RuntimeQuota | undefined,
  now: Date = new Date(),
): string[] {
  if (!quota?.available) return []

  return quota.windows.map((window) => quotaWindowLine(window, now))
}
