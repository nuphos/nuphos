import { GITHUB_API, githubFetch } from '@/lib/byos/github-http'
import { AppError } from '@/lib/errors'

import type { ResolvedResource } from './session-resource-lookup'

/** A linked GitHub issue: its title and open or closed state, with no pull request health. */
export async function resolveGithubIssue(
  input: { repository: string; number: number },
  integrationId: string,
  token: string,
  /** Words the agent can act on for a refused lookup (session-resource-lookup.ts). */
  lookupError: (response: Response, repository: string, number: number) => Error,
): Promise<ResolvedResource> {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
  const [issueResponse, repoResponse] = await Promise.all([
    githubFetch(`${GITHUB_API}/repos/${input.repository}/issues/${String(input.number)}`, {
      headers,
    }),
    githubFetch(`${GITHUB_API}/repos/${input.repository}`, { headers }),
  ])

  if (!issueResponse.ok) throw lookupError(issueResponse, input.repository, input.number)
  if (!repoResponse.ok) throw lookupError(repoResponse, input.repository, input.number)
  const issue = (await issueResponse.json()) as {
    number: number
    title: string
    state: string
    pull_request?: unknown
  }
  const repo = (await repoResponse.json()) as { id: number; full_name: string }

  // The pulls lookup missed it, so a pull request here means it was not readable as one.
  if (issue.pull_request)
    throw new AppError(502, 'resource_lookup_failed', 'GitHub returned 404 for the pull request')

  return {
    provider: 'github',
    integrationId,
    resourceId: `${String(repo.id)}/${String(issue.number)}`,
    repository: repo.full_name,
    number: issue.number,
    title: issue.title.slice(0, 300),
    state: issue.state,
    url: `https://github.com/${repo.full_name}/issues/${String(issue.number)}`,
    kind: 'issue',
  }
}
