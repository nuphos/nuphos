// Check-run roll-up behind the PR page's collapsible "checks" row. React-free
// so `node --test` can lock the rules.
import { t } from '../../i18n/index.ts'

import type { ReviewSummary } from './pullRequestStatus.ts'
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
  if (outcome === 'success') return t('successful')
  if (outcome === 'skipped') return t('skipped')

  return t('neutral')
}

/** Failing checks first, then in-progress ones, so the problems lead the list. */
export function sortChecks(checks: readonly GithubPRCheck[]): GithubPRCheck[] {
  return [...checks].sort(
    (a, b) => CHECK_OUTCOME_ORDER[checkOutcome(a)] - CHECK_OUTCOME_ORDER[checkOutcome(b)],
  )
}

const COUNT_LABELS: [CheckOutcome, (count: number) => string][] = [
  ['failure', (count) => t('{count} failing', { count })],
  ['pending', (count) => t('{count} in progress', { count })],
  ['skipped', (count) => t('{count} skipped', { count })],
  ['neutral', (count) => t('{count} neutral', { count })],
  ['success', (count) => t('{count} successful', { count })],
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
  const parts = COUNT_LABELS.filter(([outcome]) => counts[outcome] > 0).map(([outcome, label]) =>
    label(counts[outcome]),
  )
  const list = parts.join(', ')
  const detail = checks.length === 1 ? t('{list} check', { list }) : t('{list} checks', { list })

  if (counts.failure === checks.length) {
    return { tone: 'error', icon: 'x', headline: t('All checks have failed'), detail }
  }
  if (counts.failure > 0) {
    return { tone: 'error', icon: 'x', headline: t('Some checks were not successful'), detail }
  }
  if (counts.pending > 0) {
    return {
      tone: 'warning',
      icon: 'pending',
      headline: t("Some checks haven't completed yet"),
      detail,
    }
  }

  return { tone: 'success', icon: 'check', headline: t('All checks have passed'), detail }
}

// GitHub's REST payload says a merge is blocked, not why: required reviews,
// conversations, legacy commit statuses and merge queues all look the same.
export function blockedDetail(checks: StatusSummary | null, review: ReviewSummary): string {
  if (review.decision === 'changes_requested') return t('A reviewer requested changes.')
  if (checks?.tone === 'error') return t('Required status checks have failed.')
  if (checks?.tone === 'warning') return t('Required status checks have not completed yet.')
  if (review.decision === 'approved') {
    return t(
      'A branch rule is still unmet, such as an unresolved conversation or a required status. See GitHub for details.',
    )
  }

  return t('No approving review yet, or another branch rule is unmet. See GitHub for details.')
}
