import { gh, NAME } from './github-cli.ts'
import { parseRefSummary, REF_SUMMARY_QUERY } from './github-ref-summary.ts'

import type { GithubRefKey, GithubRefSummary } from '../src/types/github-pr-detail.ts'

/** Null when gh is missing, signed out, or cannot see the repository. */
export async function githubCliRefSummary(ref: GithubRefKey): Promise<GithubRefSummary | null> {
  if (!NAME.test(ref.owner) || !NAME.test(ref.repo) || !Number.isInteger(ref.number)) return null
  if (ref.number <= 0) return null
  const { ok, json } = await gh('POST', 'graphql', {
    query: REF_SUMMARY_QUERY,
    variables: { owner: ref.owner, name: ref.repo, number: ref.number },
  })

  return ok ? parseRefSummary(json) : null
}
