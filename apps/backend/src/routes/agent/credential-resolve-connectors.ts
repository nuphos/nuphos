import type { AgentCredentialOptions, AgentCredentialSelection } from './types'
import type { AgentCredentialAccess } from '@/lib/agent/db'

export type ConnectorCredentialAccess = Pick<
  AgentCredentialAccess,
  | 'githubInstallationIds'
  | 'gitlabBindingIds'
  | 'grafanaInstanceIds'
  | 'sonarqubeIntegrationIds'
  | 'notionIntegrationIds'
  | 'upstashAccountIds'
  | 'cloudflareAccountIds'
  | 'instaboxAccountIds'
  | 'personalCredentialIds'
  | 'personalConnectionIds'
>

/**
 * Undefined in, undefined out: these connectors treat an absent selection as
 * the team-wide reach they had before they became selectable, while a present
 * list — empty included — keeps only what the caller can still reach.
 */
function narrow<T, Id extends string>(
  selected: Id[] | undefined,
  available: T[],
  idOf: (item: T) => Id,
): Id[] | undefined {
  if (selected === undefined) return undefined
  const allowed = new Set(available.map(idOf))

  return selected.filter((id) => allowed.has(id))
}

export function resolveConnectorCredentialAccess(
  selection: AgentCredentialSelection,
  options: AgentCredentialOptions,
): ConnectorCredentialAccess {
  return {
    githubInstallationIds: narrow(
      selection.githubInstallationIds,
      options.githubInstallations,
      (installation) => installation.installationId,
    ),
    gitlabBindingIds: narrow(
      selection.gitlabBindingIds,
      options.gitlabBindings,
      (binding) => binding.bindingId,
    ),
    grafanaInstanceIds: narrow(
      selection.grafanaInstanceIds,
      options.grafanaInstances,
      (instance) => instance.instanceId,
    ),
    sonarqubeIntegrationIds: narrow(
      selection.sonarqubeIntegrationIds,
      options.sonarqubeIntegrations,
      (integration) => integration.integrationId,
    ),
    notionIntegrationIds: narrow(
      selection.notionIntegrationIds,
      options.notionIntegrations,
      (integration) => integration.integrationId,
    ),
    upstashAccountIds: narrow(
      selection.upstashAccountIds,
      options.upstashAccounts,
      (account) => account.accountId,
    ),
    cloudflareAccountIds: narrow(
      selection.cloudflareAccountIds,
      options.cloudflareAccounts,
      (account) => account.accountId,
    ),
    instaboxAccountIds: narrow(
      selection.instaboxAccountIds,
      options.instaboxAccounts,
      (account) => account.accountId,
    ),
    // Only the saver's own Personal Credentials can be selected.
    personalCredentialIds: narrow(
      selection.personalCredentialIds,
      options.personalCredentials,
      (credential) => credential.provider,
    ),
    personalConnectionIds: narrow(
      selection.personalConnectionIds,
      options.personalCredentials,
      (credential) => credential.id,
    ),
  }
}
