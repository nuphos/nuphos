import type { GithubSkillPreview } from '../../api/plan-types.ts'

/** The install route accepts at most this many names per request. */
export const MAX_INSTALL_NAMES = 50

/** Skills the backend would accept, preselected in the picker up to the per-install limit. */
export function installableNames(preview: GithubSkillPreview): string[] {
  return preview.skills
    .filter((skill) => !skill.problem)
    .map((skill) => skill.name)
    .slice(0, MAX_INSTALL_NAMES)
}

/** `owner/repo/path @ ref (abc1234)`: what was resolved, so the member sees the exact commit. */
export function previewSourceLabel(preview: GithubSkillPreview): string {
  const location = preview.subpath ? `${preview.repo}/${preview.subpath}` : preview.repo
  const ref = preview.ref ? ` @ ${preview.ref}` : ''

  return `${location}${ref} (${preview.commitSha.slice(0, 7)})`
}
