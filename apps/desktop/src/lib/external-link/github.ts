import { pathSegment, pathSegments } from './url.ts'

import type { GithubInstallation } from '../../types'

export type GithubLinkTarget =
  | { view: 'repo'; owner: string; repo: string; tab: 'prs' | 'workflows' }
  | { view: 'pull'; owner: string; repo: string; number: number }

// Only sections the app has a page for. An issue, a commit or a file view has
// no in-app equivalent, so those links stay in the browser rather than landing
// somewhere that shows less than the link promised.
function repoTab(section: string): 'prs' | 'workflows' | null {
  if (section === 'pulls') return 'prs'

  return section === 'actions' ? 'workflows' : null
}

export function parseGithubLink(url: URL): GithubLinkTarget | null {
  const hostname = url.hostname.toLowerCase()

  if (url.protocol !== 'https:') return null
  if (hostname !== 'github.com' && hostname !== 'www.github.com') return null
  const segs = pathSegments(url)

  if (!segs) return null
  const [owner, repo, section, sectionArg] = segs

  if (!owner || !repo) return null
  if (segs.length === 2) return { view: 'repo', owner, repo, tab: 'prs' }
  if (section === 'pull') {
    const number = Number(sectionArg)

    if (!/^\d+$/.test(sectionArg) || number < 1) return null

    return { view: 'pull', owner, repo, number }
  }
  const tab = repoTab(section)

  return tab ? { view: 'repo', owner, repo, tab } : null
}

/** A GitHub App installation is bound to one account, so the repo owner names it. */
function installationForOwner(
  installations: readonly GithubInstallation[],
  owner: string,
): GithubInstallation | null {
  const wanted = owner.toLowerCase()

  return installations.find((item) => item.accountLogin.toLowerCase() === wanted) ?? null
}

export function githubAppPath(
  teamId: string,
  installations: readonly GithubInstallation[],
  target: GithubLinkTarget,
): string | null {
  const installation = installationForOwner(installations, target.owner)

  if (!installation) return null
  const base = `/teams/${pathSegment(teamId)}/repository/installations/${pathSegment(String(installation.installationId))}/repos/${pathSegment(installation.accountLogin)}/${pathSegment(target.repo)}`

  // A PR link may point at a merged or closed PR, so the list it backs out to
  // must be able to show it.
  if (target.view === 'pull') {
    return `${base}/pull-requests/${pathSegment(String(target.number))}?state=all`
  }

  return target.tab === 'workflows' ? `${base}/workflows` : base
}
