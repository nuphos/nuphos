// Check-run roll-up behind the PR page's collapsible "checks" row. React-free
// so `node --test` can lock the rules.
import type { GithubPRCheck } from '../../types'

export type StatusTone = 'success' | 'error' | 'warning' | 'neutral' | 'merged'
export type StatusIconKind = 'check' | 'x' | 'pending' | 'alert' | 'merged' | 'closed' | 'draft'
export type StatusSummary = {
  tone: StatusTone
  icon: StatusIconKind
  headline: string
  detail: string
}

export type CheckOutcome = 'success' | 'failure' | 'pending' | 'skipped' | 'neutral'

const FAILED_CONCLUSIONS = new Set([
  'failure',
  'cancelled',
  'timed_out',
  'action_required',
  'startup_failure',
  'stale',
])

const CHECK_OUTCOME_ORDER: Record<CheckOutcome, number> = {
  failure: 0,
  pending: 1,
  neutral: 2,
  skipped: 3,
  success: 4,
}

export function humanize(value: string): string {
  return value.replaceAll('_', ' ')
}

export function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`
}

export function checkOutcome(check: GithubPRCheck): CheckOutcome {
  if (check.status !== 'completed') return 'pending'
  if (check.conclusion === 'success') return 'success'
  if (check.conclusion === 'skipped') return 'skipped'
  if (check.conclusion && FAILED_CONCLUSIONS.has(check.conclusion)) return 'failure'

  return 'neutral'
}

/** The per-row status text: the concrete conclusion when it failed, else the phase. */
export function checkStatusText(check: GithubPRCheck): string {
  const outcome = checkOutcome(check)

  if (outcome === 'failure') return humanize(check.conclusion ?? 'failure')
  if (outcome === 'pending') return humanize(check.status)
  if (outcome === 'success') return 'successful'

  return outcome
}

/** Failing checks first, then in-progress ones, so the problems lead the list. */
export function sortChecks(checks: readonly GithubPRCheck[]): GithubPRCheck[] {
  return [...checks].sort(
    (a, b) => CHECK_OUTCOME_ORDER[checkOutcome(a)] - CHECK_OUTCOME_ORDER[checkOutcome(b)],
  )
}

const COUNT_LABELS: [CheckOutcome, string][] = [
  ['failure', 'failing'],
  ['pending', 'in progress'],
  ['skipped', 'skipped'],
  ['neutral', 'neutral'],
  ['success', 'successful'],
]

export function summarizeChecks(checks: readonly GithubPRCheck[]): StatusSummary | null {
  if (checks.length === 0) return null
  const counts: Record<CheckOutcome, number> = {
    success: 0,
    failure: 0,
    pending: 0,
    skipped: 0,
    neutral: 0,
  }

  for (const check of checks) counts[checkOutcome(check)] += 1
  const parts = COUNT_LABELS.filter(([outcome]) => counts[outcome] > 0).map(
    ([outcome, label]) => `${String(counts[outcome])} ${label}`,
  )
  const detail = `${parts.join(', ')} ${checks.length === 1 ? 'check' : 'checks'}`

  if (counts.failure === checks.length) {
    return { tone: 'error', icon: 'x', headline: 'All checks have failed', detail }
  }
  if (counts.failure > 0) {
    return { tone: 'error', icon: 'x', headline: 'Some checks were not successful', detail }
  }
  if (counts.pending > 0) {
    return {
      tone: 'warning',
      icon: 'pending',
      headline: "Some checks haven't completed yet",
      detail,
    }
  }

  return { tone: 'success', icon: 'check', headline: 'All checks have passed', detail }
}
