import type { GithubSkillUpdate } from '../../api/plan-types.ts'

export const canUpdate = (update: GithubSkillUpdate): boolean =>
  update.status === 'update_available' && !update.problem

/** Update all: every skill with an update except those edited in Nuphos. */
export function defaultUpdateSelection(updates: GithubSkillUpdate[]): string[] {
  return updates.filter((u) => canUpdate(u) && !u.edited).map((u) => u.name)
}

/** Selected skills whose edits in Nuphos the update would replace. */
export function editedSelected(updates: GithubSkillUpdate[], selected: string[]): string[] {
  return updates.filter((u) => u.edited && selected.includes(u.name)).map((u) => u.name)
}

/** The latest commit the member reviewed for each picked skill; the backend refuses others. */
export function reviewedCommits(
  updates: GithubSkillUpdate[],
  selected: string[],
): Record<string, string> {
  return Object.fromEntries(
    updates.flatMap((u) =>
      selected.includes(u.name) && u.latestCommit ? [[u.name, u.latestCommit]] : [],
    ),
  )
}

/** GitHub page of the installed folder at the installed commit. */
export function originUrl(origin: { repo: string; path: string; commitSha: string }): string {
  const path = origin.path
    ? `/tree/${origin.commitSha}/${origin.path}`
    : `/tree/${origin.commitSha}`

  return `https://github.com/${origin.repo}${path}`
}
