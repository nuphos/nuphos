import { canUseAllowList } from '@/lib/byos/access'

import type { TeamByosBindings } from '@/models'
import type { AgentCredentialOptions } from './types'

type ConnectorKeys =
  | 'githubInstallations'
  | 'gitlabAccounts'
  | 'grafanaInstances'
  | 'sonarqubeIntegrations'
  | 'notionIntegrations'
  | 'upstashAccounts'
  | 'posthogIntegrations'
  | 'cloudflareAccounts'

export type ConnectorBindingsDoc = Pick<TeamByosBindings, ConnectorKeys>

export type ConnectorCredentialOptions = Pick<
  AgentCredentialOptions,
  | 'githubInstallations'
  | 'gitlabBindings'
  | 'grafanaInstances'
  | 'sonarqubeIntegrations'
  | 'notionIntegrations'
  | 'upstashAccounts'
  | 'posthogIntegrations'
  | 'cloudflareAccounts'
>

export const emptyConnectorCredentialOptions = (): ConnectorCredentialOptions => ({
  githubInstallations: [],
  gitlabBindings: [],
  grafanaInstances: [],
  sonarqubeIntegrations: [],
  notionIntegrations: [],
  upstashAccounts: [],
  posthogIntegrations: [],
  cloudflareAccounts: [],
})

export const connectorCredentialOptionsProjection = {
  githubInstallations: 1,
  gitlabAccounts: 1,
  grafanaInstances: 1,
  sonarqubeIntegrations: 1,
  notionIntegrations: 1,
  upstashAccounts: 1,
  posthogIntegrations: 1,
  cloudflareAccounts: 1,
} as const

export function connectorCredentialOptions(
  doc: ConnectorBindingsDoc | null,
  userId: string,
): ConnectorCredentialOptions {
  const githubInstallations = (doc?.githubInstallations ?? [])
    .filter((binding) => canUseAllowList(binding.access?.memberAllowList, userId))
    .map((binding) => ({
      // The GitHub App installation id, not the binding's ObjectId: it is the route key.
      installationId: String(binding.installationId),
      accountLogin: binding.accountLogin,
      accountType: binding.accountType,
    }))
  // GitLab bindings live under `gitlabAccounts` on the team document.
  const gitlabBindings = (doc?.gitlabAccounts ?? [])
    .filter((binding) => canUseAllowList(binding.access?.memberAllowList, userId))
    .map((binding) => ({
      bindingId: binding.id.toHexString(),
      hostUrl: binding.hostUrl,
      username: binding.username,
    }))
  const grafanaInstances = (doc?.grafanaInstances ?? [])
    .filter((binding) => canUseAllowList(binding.access?.memberAllowList, userId))
    .map((binding) => ({
      instanceId: binding.id.toHexString(),
      name: binding.name,
      grafanaUrl: binding.grafanaUrl,
    }))
  const sonarqubeIntegrations = (doc?.sonarqubeIntegrations ?? [])
    .filter((binding) => canUseAllowList(binding.access?.memberAllowList, userId))
    .map((binding) => ({
      integrationId: binding.id.toHexString(),
      label: binding.label,
      baseUrl: binding.baseUrl,
    }))
  const notionIntegrations = (doc?.notionIntegrations ?? [])
    .filter((binding) => canUseAllowList(binding.access?.memberAllowList, userId))
    .map((binding) => ({
      integrationId: binding.id.toHexString(),
      label: binding.label,
      workspaceName: binding.workspaceName,
    }))
  const upstashAccounts = (doc?.upstashAccounts ?? [])
    .filter((binding) => canUseAllowList(binding.access?.memberAllowList, userId))
    .map((binding) => ({
      accountId: binding.id.toHexString(),
      label: binding.label,
      email: binding.email,
    }))
  const posthogIntegrations = (doc?.posthogIntegrations ?? [])
    .filter((binding) => canUseAllowList(binding.access?.memberAllowList, userId))
    .map((binding) => ({
      integrationId: binding.id.toHexString(),
      label: binding.label,
      apiBaseUrl: binding.apiBaseUrl,
      projects: binding.projects.map((project) => ({ id: project.id, name: project.name })),
    }))
  const cloudflareAccounts = (doc?.cloudflareAccounts ?? [])
    .filter((binding) => canUseAllowList(binding.access?.memberAllowList, userId))
    .map((binding) => ({
      // Cloudflare's own account id, not the binding's ObjectId: it is the route key.
      accountId: binding.accountId,
      accountName: binding.accountName,
    }))

  return {
    githubInstallations,
    gitlabBindings,
    grafanaInstances,
    sonarqubeIntegrations,
    notionIntegrations,
    upstashAccounts,
    posthogIntegrations,
    cloudflareAccounts,
  }
}
