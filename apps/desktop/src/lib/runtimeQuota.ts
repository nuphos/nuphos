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

/** What is still unspent, floored so a nearly empty window never reads as more than it has. */
export function quotaLeftPercent(window: RuntimeQuotaWindow): number {
  return Math.max(0, Math.min(100, Math.floor(100 - window.usedPercent)))
}

export function quotaSummary(quota: RuntimeQuota | undefined): string | null {
  const worst = mostConstrainedWindow(quota)

  if (!worst) return null

  return t('{percent}% left', { percent: quotaLeftPercent(worst) })
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

  if (deltaMinutes <= 0) return t('resets now')
  if (deltaMinutes >= 24 * 60) return t('resets {when}', { when: formatWeekday(at) })
  const hours = Math.floor(deltaMinutes / 60)
  const minutes = deltaMinutes % 60
  const relative =
    hours > 0 ? t('{hours}h {minutes}m', { hours, minutes }) : t('{minutes}m', { minutes })

  return t('resets in {time} ({clock})', { time: relative, clock: formatClock(at) })
}

export function quotaWindowLine(window: RuntimeQuotaWindow, now: Date): string {
  const reset = formatResetsAt(window.resetsAt, now)
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
  const resets = quotaResetsLine(quota)

  return [
    ...quota.windows.map((window) => quotaWindowLine(window, now)),
    ...(resets ? [resets] : []),
  ]
}

/** "2 resets · use by Dec 10": the Claude limit resets the account holds, if any. */
export function quotaResetsLine(quota: RuntimeQuota | undefined): string | null {
  const resets = quota?.available ? quota.resets : undefined

  if (!resets || resets.left <= 0) return null
  const count = resets.left === 1 ? t('1 reset') : t('{count} resets', { count: resets.left })
  const by = resets.expiresAt ? new Date(resets.expiresAt) : null

  if (!by || Number.isNaN(by.getTime())) return count

  return `${count} · ${t('use by {date}', { date: by.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) })}`
}

const RESET_KINDS: Record<string, () => string> = {
  weekly: () => t('Weekly reset'),
  session: () => t('5-hour reset'),
  fable: () => t('Fable reset'),
  full: () => t('Full reset'),
}

/** The kind of reset spent next, as Anthropic names it; an unknown name is shown as is. */
export function resetKindLabel(kind: string | null): string {
  return (kind && RESET_KINDS[kind]?.()) ?? kind ?? t('Limit reset')
}

/** Why a reset action did not go through, for the owner; null when it did. Nothing is
 *  retried on its own: a spend that may have reached Anthropic must not run twice. */
export function resetOutcomeError(result: string): string | null {
  if (result === 'reset' || result === 'saved') return null
  if (result === 'none') return t('No reset can be used right now. Nothing was spent.')
  if (['already_used', 'not_limited', 'cooldown', 'ineligible'].includes(result))
    return t('Anthropic declined it: {reason}', { reason: result })

  return t(
    'Anthropic did not answer as expected, and nothing is retried. Check claude.ai/settings/usage before trying again.',
  )
}
