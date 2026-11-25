import { getInstallationToken } from '@/lib/byos/github'
import { GITHUB_API, githubFetch } from '@/lib/byos/github-http'
import { logEvent } from '@/lib/observability'

/**
 * Why an open PR is stuck, for its tag's color: checks that failed (red), or a
 * reviewer's requested changes or a merge conflict (yellow). Absent when
 * nothing blocks it.
 */
export type PullHealth = 'checks_failed' | 'changes_requested' | 'conflict'

const FAILED_CONCLUSIONS = new Set([
  'failure',
  'timed_out',
  'cancelled',
  'action_required',
  'startup_failure',
])

export type PullHealthInput = {
  /** Conclusions of the head commit's latest check runs (null while running). */
  checkConclusions: (string | null)[]
  /** The head commit's combined status: success, failure, error or pending. */
  statusState?: string
  /** GitHub's `mergeable_state`; `dirty` means conflicts. */
  mergeableState?: string | null
  /** Reviews in the order GitHub returns them (oldest first). */
  reviews: { user: string; state: string }[]
}

export function pullHealth(input: PullHealthInput): PullHealth | null {
  if (
    input.checkConclusions.some((conclusion) => conclusion && FAILED_CONCLUSIONS.has(conclusion)) ||
    input.statusState === 'failure' ||
    input.statusState === 'error'
  )
    return 'checks_failed'
  // A reviewer's latest decision counts; comments alone change nothing.
  const decisions = new Map<string, string>()

  for (const review of input.reviews) {
    if (['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state))
      decisions.set(review.user, review.state)
  }
  if ([...decisions.values()].includes('CHANGES_REQUESTED')) return 'changes_requested'
  if (input.mergeableState === 'dirty') return 'conflict'

  return null
}

async function getJson<T>(token: string, path: string): Promise<T | null> {
  const response = await githubFetch(`${GITHUB_API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  })

  if (!response.ok) {
    logEvent('warn', 'github.resource.health_lookup_failed', { status: response.status })

    return null
  }

  return (await response.json()) as T
}

const REVIEW_PAGES = 20

/** Every page of a 100-per-page list, in order; null when a page is unreadable. */
async function getPages<T>(token: string, path: string): Promise<T[] | null> {
  const items: T[] = []

  for (let page = 1; page <= REVIEW_PAGES; page++) {
    const batch = await getJson<T[]>(token, `${path}?per_page=100&page=${String(page)}`)

    if (!batch) return null
    items.push(...batch)
    if (batch.length < 100) break
  }

  return items
}

type PullSummary = { state: string; mergeable_state?: string | null; head: { sha: string } }

/**
 * The head commit's CI once nothing in it is queued, running or pending, else
 * null. `id` names this exact set of results, so a re-run settles anew.
 */
export type SettledCi = { id: string; summary: string }

type CheckRun = { id: number; name: string; status: string; conclusion: string | null }
type CommitStatus = { id: number; context: string; state: string }

/**
 * Each check's newest run. GitHub's `filter=latest` keeps one per check suite,
 * so a run that a later workflow run replaced on the same commit, such as one
 * cancelled by `cancel-in-progress`, still comes back beside its replacement.
 */
export function latestRuns<T extends { id: number; name: string }>(runs: T[]): T[] {
  const newest = new Map<string, T>()

  for (const run of runs) if (run.id > (newest.get(run.name)?.id ?? -1)) newest.set(run.name, run)

  return [...newest.values()]
}

export function settledCi(
  sha: string,
  allRuns: CheckRun[],
  statuses: CommitStatus[],
): SettledCi | null {
  const runs = latestRuns(allRuns)

  if (!runs.length && !statuses.length) return null
  if (runs.some((run) => run.status !== 'completed')) return null
  if (statuses.some((status) => status.state === 'pending')) return null
  const failed = [
    ...runs.filter((run) => FAILED_CONCLUSIONS.has(run.conclusion ?? '')).map((run) => run.name),
    ...statuses
      .filter((status) => ['failure', 'error'].includes(status.state))
      .map((status) => status.context),
  ]

  return {
    id: [...runs.map((run) => `r${String(run.id)}`), ...statuses.map((s) => `s${String(s.id)}`)]
      .sort((a, b) => a.localeCompare(b))
      .join(','),
    summary: `GitHub CI finished on ${sha.slice(0, 7)}: ${
      failed.length ? `failed (${failed.join(', ')})` : 'passed'
    }.`,
  }
}

/**
 * Asks GitHub what blocks an open PR and whether its head's CI has settled.
 * Null when it is closed or unreadable. Pass `known` when the PR was just
 * fetched, to skip that lookup.
 */
export async function readPull(
  installationId: number,
  repository: string,
  number: number,
  known?: PullSummary,
): Promise<{ health: PullHealth | null; ci: SettledCi | null } | null> {
  const { token } = await getInstallationToken(installationId)
  const pull =
    known ?? (await getJson<PullSummary>(token, `/repos/${repository}/pulls/${String(number)}`))

  if (pull?.state !== 'open') return null
  const sha = pull.head.sha
  const [checks, status, reviews] = await Promise.all([
    getJson<{ check_runs: CheckRun[] }>(
      token,
      `/repos/${repository}/commits/${sha}/check-runs?filter=latest&per_page=100`,
    ),
    getJson<{ state: string; total_count: number; statuses: CommitStatus[] }>(
      token,
      `/repos/${repository}/commits/${sha}/status`,
    ),
    // Oldest first, so a reviewer's later approval can sit past the first page.
    getPages<{ user: { login: string } | null; state: string }>(
      token,
      `/repos/${repository}/pulls/${String(number)}/reviews`,
    ),
  ])

  return {
    health: pullHealth({
      checkConclusions: latestRuns(checks?.check_runs ?? []).map((run) => run.conclusion),
      // With no statuses at all GitHub still says "pending"; that blocks nothing.
      statusState: status && status.total_count > 0 ? status.state : undefined,
      mergeableState: pull.mergeable_state,
      reviews: (reviews ?? []).map((review) => ({
        user: review.user?.login ?? '',
        state: review.state,
      })),
    }),
    // Unreadable CI is never settled.
    ci: checks && status ? settledCi(sha, checks.check_runs, status.statuses) : null,
  }
}
