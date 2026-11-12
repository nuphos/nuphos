import type { GithubSkillUpdate } from '../../api/plan-types.ts'

/** The update route accepts at most this many names per request. */
export const MAX_UPDATE_NAMES = 50

export const canUpdate = (update: GithubSkillUpdate): boolean =>
  update.status === 'update_available' && !update.problem

/** Update all: every skill with an update except those edited in Nuphos. */
export function defaultUpdateSelection(updates: GithubSkillUpdate[]): string[] {
  return updates
    .filter((u) => canUpdate(u) && !u.edited)
    .map((u) => u.name)
    .slice(0, MAX_UPDATE_NAMES)
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
  const segments = origin.path.split('/').filter(Boolean).map(encodeURIComponent)

  return `https://github.com/${origin.repo}/${['tree', origin.commitSha, ...segments].join('/')}`
}
