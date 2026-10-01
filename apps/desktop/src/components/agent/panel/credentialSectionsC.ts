import type { CredentialSection } from './credentialSections'
import type { AgentCredentialOptions } from '../../../api'

export function buildGithubCredentialSections(
  installations: AgentCredentialOptions['githubInstallations'],
): CredentialSection[] {
  if (installations.length === 0) return []

  return [
    {
      id: 'github',
      provider: 'github' as const,
      title: 'GitHub',
      items: installations.map((installation) => ({
        id: installation.installationId,
        label: installation.accountLogin,
        sublabel: installation.accountType === 'Organization' ? 'Organization' : 'User',
      })),
    },
  ]
}

export function buildGitlabCredentialSections(
  bindings: AgentCredentialOptions['gitlabBindings'],
): CredentialSection[] {
  if (bindings.length === 0) return []

  return [
    {
      id: 'gitlab',
      provider: 'gitlab' as const,
      title: 'GitLab',
      items: bindings.map((binding) => ({
        id: binding.bindingId,
        label: binding.username,
        sublabel: binding.hostUrl.replace(/^https?:\/\//, ''),
      })),
    },
  ]
}

export function buildGrafanaCredentialSections(
  instances: AgentCredentialOptions['grafanaInstances'],
): CredentialSection[] {
  if (instances.length === 0) return []

  return [
    {
      id: 'grafana',
      provider: 'grafana' as const,
      title: 'Grafana',
      items: instances.map((instance) => ({
        id: instance.instanceId,
        label: instance.name,
        sublabel: instance.grafanaUrl.replace(/^https?:\/\//, ''),
      })),
    },
  ]
}

export function buildSonarqubeCredentialSections(
  integrations: AgentCredentialOptions['sonarqubeIntegrations'],
): CredentialSection[] {
  if (integrations.length === 0) return []

  return [
    {
      id: 'sonarqube',
      provider: 'sonarqube' as const,
      title: 'SonarQube',
      items: integrations.map((integration) => ({
        id: integration.integrationId,
        label: integration.label,
        sublabel: integration.baseUrl.replace(/^https?:\/\//, ''),
      })),
    },
  ]
}

export function buildNotionCredentialSections(
  integrations: AgentCredentialOptions['notionIntegrations'],
): CredentialSection[] {
  if (integrations.length === 0) return []

  return [
    {
      id: 'notion',
      provider: 'notion' as const,
      title: 'Notion',
      items: integrations.map((integration) => ({
        id: integration.integrationId,
        label: integration.label,
        sublabel: integration.workspaceName ?? '',
      })),
    },
  ]
}

export function buildUpstashCredentialSections(
  accounts: AgentCredentialOptions['upstashAccounts'],
): CredentialSection[] {
  if (accounts.length === 0) return []

  return [
    {
      id: 'upstash',
      provider: 'upstash' as const,
      title: 'Upstash',
      items: accounts.map((account) => ({
        id: account.accountId,
        label: account.label,
        sublabel: account.email ?? '',
      })),
    },
  ]
}

export function buildCloudflareCredentialSections(
  accounts: AgentCredentialOptions['cloudflareAccounts'],
): CredentialSection[] {
  if (accounts.length === 0) return []

  return [
    {
      id: 'cloudflare',
      provider: 'cloudflare' as const,
      title: 'Cloudflare',
      items: accounts.map((account) => ({
        id: account.accountId,
        label: account.accountName ?? account.accountId,
        sublabel: account.accountId,
      })),
    },
  ]
}
