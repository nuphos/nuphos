import { LINEAR_PAGE_KEY } from './linearNav.ts'

import type { NavigationSnapshot } from './app-routes/types.ts'

export type ExternalPageLink = { url: string; provider: 'github' | 'linear' }

type ExternalLinkSource = Pick<
  NavigationSnapshot,
  'active' | 'githubNav' | 'repoProvider' | 'linearNav'
>

function githubPageLink(nav: NavigationSnapshot['githubNav']): string | null {
  switch (nav.view) {
    case 'pull':
      return `${nav.repo.htmlUrl}/pull/${String(nav.prNumber)}`
    case 'repo':
      return `${nav.repo.htmlUrl}/${nav.tab === 'prs' ? 'pulls' : 'actions'}`
    case 'repos':
      return nav.installation.accountLogin
        ? `https://github.com/${encodeURIComponent(nav.installation.accountLogin)}`
        : null
    case 'installations':
      return null
  }
}

function linearPageLink(nav: NavigationSnapshot['linearNav']): string | null {
  if (nav?.view === 'issue') return nav.url ?? null
  if (nav?.view === 'team') return nav.team.url ?? null

  return null
}

export function externalPageLink(tab: ExternalLinkSource): ExternalPageLink | null {
  if (tab.active === 'team.repository' && tab.repoProvider === 'github') {
    const url = githubPageLink(tab.githubNav)

    return url ? { url, provider: 'github' } : null
  }
  if (tab.active === LINEAR_PAGE_KEY) {
    const url = linearPageLink(tab.linearNav)

    return url ? { url, provider: 'linear' } : null
  }

  return null
}
