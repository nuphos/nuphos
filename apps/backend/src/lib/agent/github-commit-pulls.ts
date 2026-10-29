import { getInstallationToken } from '@/lib/byos/github'
import { GITHUB_API, githubFetch } from '@/lib/byos/github-http'
import { logEvent } from '@/lib/observability'

import { agentConversations } from './db'

type CommitPull = { number: number; state: string; head: { sha: string } }

const OPEN_PULL_PAGES = 5

async function openPulls(repository: string, headers: Record<string, string>) {
  const pulls: CommitPull[] = []

  for (let page = 1; page <= OPEN_PULL_PAGES; page++) {
    const response = await githubFetch(
      `${GITHUB_API}/repos/${repository}/pulls?state=open&per_page=100&page=${String(page)}`,
      { headers },
    )

    if (!response.ok) {
      logEvent('warn', 'github.resource.open_pulls_lookup_failed', { status: response.status })
      break
    }
    const batch = (await response.json()) as CommitPull[]

    pulls.push(...batch)
    if (batch.length < 100) break
  }

  return pulls
}

/**
 * Keys of the open PRs whose head is a commit. `/commits/{sha}/pulls` only knows
 * commits on this repository's branches, so for a fork PR's head it is empty and
 * the open PRs are read instead.
 */
export async function commitPullKeys(commit: {
  installationId: number
  repositoryId: number
  repository: string
  sha: string
}) {
  const prefix = `github/${String(commit.installationId)}/${String(commit.repositoryId)}/`
  // Statuses are frequent; only ask GitHub which PRs hold the commit when one is linked here.
  const linked = await agentConversations().findOne(
    { 'linkedResources.key': { $regex: `^${prefix}` } },
    { projection: { _id: 1 } },
  )

  if (!linked) return []
  const { token } = await getInstallationToken(commit.installationId)
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
  const response = await githubFetch(
    `${GITHUB_API}/repos/${commit.repository}/commits/${commit.sha}/pulls`,
    { headers },
  )

  if (!response.ok) {
    logEvent('warn', 'github.resource.commit_pulls_lookup_failed', {
      installation_id: commit.installationId,
      status: response.status,
    })

    return []
  }
  let pulls = (await response.json()) as CommitPull[]

  if (!pulls.length) pulls = await openPulls(commit.repository, headers)

  // The lookup also returns merged PRs and PRs that moved past this commit; skip them.
  return pulls
    .filter((pull) => pull.state === 'open' && pull.head.sha === commit.sha)
    .map((pull) => `${prefix}${String(pull.number)}`)
}
