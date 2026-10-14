import type { GithubInstallation } from '../../types'

/** "personal" for a user account, "organization" for an org. */
export function githubAccountKind(installation: GithubInstallation): 'personal' | 'organization' {
  return installation.accountType === 'Organization' ? 'organization' : 'personal'
}

/** The installation's repository grant as GitHub names it. */
export function githubRepoAccessLabel(installation: GithubInstallation): string {
  return installation.targetType === 'all' ? 'All repositories' : 'Selected repositories'
}

/** One line naming where the app is installed: the account when there is one. */
export function githubConnectedSummary(installations: GithubInstallation[]): string {
  if (installations.length === 1) {
    const [installation] = installations

    return `Connected · ${installation.accountLogin} (${githubAccountKind(installation)})`
  }

  return `Connected · ${String(installations.length)} accounts`
}

/** GitHub's own settings page for the installation, where repo access is changed. */
export function githubInstallationSettingsUrl(installation: GithubInstallation): string {
  const id = String(installation.installationId)

  return installation.accountType === 'Organization'
    ? `https://github.com/organizations/${encodeURIComponent(installation.accountLogin)}/settings/installations/${id}`
    : `https://github.com/settings/installations/${id}`
}

/** Installations still shown as connector rows (drops ones being deleted). */
export function visibleGithubInstallations(
  installations: GithubInstallation[],
  rowKeys: string[],
): GithubInstallation[] {
  const keys = new Set(rowKeys)

  return installations.filter((installation) =>
    keys.has(`github:${String(installation.installationId)}`),
  )
}
