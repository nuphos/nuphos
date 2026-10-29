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
 * Asks GitHub what blocks an open PR. Null when it is closed, unblocked, or
 * unreadable. Pass `known` when the PR was just fetched, to skip that lookup.
 */
export async function fetchPullHealth(
  installationId: number,
  repository: string,
  number: number,
  known?: PullSummary,
): Promise<PullHealth | null> {
  const { token } = await getInstallationToken(installationId)
  const pull =
    known ?? (await getJson<PullSummary>(token, `/repos/${repository}/pulls/${String(number)}`))

  if (pull?.state !== 'open') return null
  const sha = pull.head.sha
  const [checks, status, reviews] = await Promise.all([
    getJson<{ check_runs: { conclusion: string | null }[] }>(
      token,
      `/repos/${repository}/commits/${sha}/check-runs?filter=latest&per_page=100`,
    ),
    getJson<{ state: string; total_count: number }>(
      token,
      `/repos/${repository}/commits/${sha}/status`,
    ),
    // Oldest first, so a reviewer's later approval can sit past the first page.
    getPages<{ user: { login: string } | null; state: string }>(
      token,
      `/repos/${repository}/pulls/${String(number)}/reviews`,
    ),
  ])

  return pullHealth({
    checkConclusions: checks?.check_runs.map((run) => run.conclusion) ?? [],
    // With no statuses at all GitHub still says "pending"; that blocks nothing.
    statusState: status && status.total_count > 0 ? status.state : undefined,
    mergeableState: pull.mergeable_state,
    reviews: (reviews ?? []).map((review) => ({
      user: review.user?.login ?? '',
      state: review.state,
    })),
  })
}
