import type { GithubPR, GithubWorkflowRun } from '../../types'

function normalize(filter: string): string {
  return filter.trim().toLowerCase()
}

function includes(value: string | null | undefined, needle: string): boolean {
  return typeof value === 'string' && value.toLowerCase().includes(needle)
}

/** A pull matches on its number (`42` or `#42`), title, author, branch, or label. */
export function matchesPullFilter(pr: GithubPR, filter: string): boolean {
  const needle = normalize(filter)

  if (!needle) return true
  const number = needle.startsWith('#') ? needle.slice(1) : needle

  return (
    String(pr.number) === number ||
    includes(pr.title, needle) ||
    includes(pr.author, needle) ||
    includes(pr.headRef, needle) ||
    pr.labels.some((label) => includes(label.name, needle))
  )
}

/** A run matches on its id, workflow name, branch, or triggering event. */
export function matchesRunFilter(run: GithubWorkflowRun, filter: string): boolean {
  const needle = normalize(filter)

  if (!needle) return true

  return (
    String(run.id) === needle ||
    includes(run.name, needle) ||
    includes(run.headBranch, needle) ||
    includes(run.event, needle)
  )
}
