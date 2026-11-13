import { t } from '../../i18n'

import { githubConnectedSummary, visibleGithubInstallations } from './github-installation-display'

import type { IntegrationPlatformRow } from './team-home-bind'
import type { GithubInstallation } from '../../types'
import type { CatalogItem } from '../addIntegrationCatalog'

export type ConnectedSummary = { text: string; attention: boolean }

export function summarizeConnection(
  item: CatalogItem,
  installed: IntegrationPlatformRow[],
  githubInstallations: GithubInstallation[],
): ConnectedSummary | null {
  if (installed.length === 0) return null
  const needing = installed.filter((row) => row.attention)

  if (needing.length > 0) {
    const text =
      installed.length === 1
        ? `${installed[0].account} · ${String(needing[0].attention)}`
        : t('{n} of {total} connections need attention', {
            n: needing.length,
            total: installed.length,
          })

    return { text, attention: true }
  }
  if (item.key === 'github') {
    const github = visibleGithubInstallations(
      githubInstallations,
      installed.map((row) => row.key),
    )

    if (github.length > 0) return { text: githubConnectedSummary(github), attention: false }
  }

  return {
    text:
      installed.length === 1 ? installed[0].account : t('{n} connections', { n: installed.length }),
    attention: false,
  }
}
