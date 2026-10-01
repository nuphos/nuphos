import type { CredentialSection } from './credentialSections'
import type { AgentCredentialOptions } from '../../../api'

export function buildAzureCredentialSections(
  accounts: AgentCredentialOptions['azureAccounts'],
): CredentialSection[] {
  if (accounts.length === 0) return []

  return [
    {
      id: 'azure',
      provider: 'azure' as const,
      title: 'Microsoft Azure',
      items: accounts.map((account) => ({
        id: account.accountId,
        label: account.label,
        sublabel: account.subscriptionId,
      })),
    },
  ]
}

export function buildVantaCredentialSections(
  integrations: AgentCredentialOptions['vantaIntegrations'],
): CredentialSection[] {
  if (integrations.length === 0) return []

  return [
    {
      id: 'vanta',
      provider: 'vanta' as const,
      title: 'Vanta',
      items: integrations.map((integration) => ({
        id: integration.integrationId,
        label: integration.label,
        sublabel: integration.authType === 'oauth' ? 'OAuth' : 'Client credentials',
      })),
    },
  ]
}

export function buildSecureframeCredentialSections(
  integrations: AgentCredentialOptions['secureframeIntegrations'],
): CredentialSection[] {
  if (integrations.length === 0) return []

  return [
    {
      id: 'secureframe',
      provider: 'secureframe' as const,
      title: 'Secureframe',
      items: integrations.map((integration) => ({
        id: integration.integrationId,
        label: integration.label,
        sublabel: `${integration.region.toUpperCase()} region`,
      })),
    },
  ]
}

export function buildResendCredentialSections(
  integrations: AgentCredentialOptions['resendIntegrations'],
): CredentialSection[] {
  if (integrations.length === 0) return []

  return [
    {
      id: 'resend',
      provider: 'resend' as const,
      title: 'Resend',
      items: integrations.map((integration) => ({
        id: integration.integrationId,
        label: integration.label,
        sublabel: integration.permission === 'sending_access' ? 'Can send email' : 'Full access',
      })),
    },
  ]
}

export function buildBetterStackCredentialSections(
  integrations: AgentCredentialOptions['betterStackIntegrations'],
): CredentialSection[] {
  if (integrations.length === 0) return []

  return [
    {
      id: 'betterstack',
      provider: 'betterstack' as const,
      title: 'Better Stack',
      items: integrations.map((integration) => ({
        id: integration.integrationId,
        label: integration.label,
        sublabel: [
          integration.hasUptimeApiToken ? 'Uptime' : null,
          integration.hasTelemetryApiToken ? 'Telemetry' : null,
        ]
          .filter(Boolean)
          .join(' + '),
      })),
    },
  ]
}

export function buildUptimeKumaCredentialSections(
  instances: AgentCredentialOptions['uptimeKumaInstances'],
): CredentialSection[] {
  if (instances.length === 0) return []

  return [
    {
      id: 'uptime-kuma',
      provider: 'uptime-kuma' as const,
      title: 'Uptime Kuma',
      items: instances.map((instance) => ({
        id: instance.instanceId,
        label: instance.label,
        sublabel: `${instance.authType === 'token' ? 'Auth token' : 'Username/password'} · ${instance.baseUrl.replace(/^https?:\/\//, '')}`,
      })),
    },
  ]
}

export function buildLinearCredentialSections(
  workspaces: AgentCredentialOptions['linearWorkspaces'],
): CredentialSection[] {
  if (workspaces.length === 0) return []

  return [
    {
      id: 'linear',
      provider: 'linear' as const,
      title: 'Linear',
      items: workspaces.map((workspace) => ({
        id: workspace.workspaceId,
        label: workspace.label,
        sublabel: workspace.workspaceName,
      })),
    },
  ]
}

export function buildJiraCredentialSections(
  sites: AgentCredentialOptions['jiraSites'],
): CredentialSection[] {
  if (sites.length === 0) return []

  return [
    {
      id: 'jira',
      provider: 'jira' as const,
      title: 'Jira',
      items: sites.map((site) => ({
        id: site.siteId,
        label: site.label,
        sublabel: site.siteUrl.replace(/^https?:\/\//, ''),
      })),
    },
  ]
}

export function buildAsanaCredentialSections(
  accounts: AgentCredentialOptions['asanaAccounts'],
): CredentialSection[] {
  if (accounts.length === 0) return []

  return [
    {
      id: 'asana',
      provider: 'asana' as const,
      title: 'Asana',
      items: accounts.map((account) => ({
        id: account.accountId,
        label: account.label,
        sublabel: account.accountEmail ?? '',
      })),
    },
  ]
}

export function buildSentryCredentialSections(
  accounts: AgentCredentialOptions['sentryAccounts'],
): CredentialSection[] {
  if (accounts.length === 0) return []

  return [
    {
      id: 'sentry',
      provider: 'sentry' as const,
      title: 'Sentry',
      items: accounts.map((account) => ({
        id: account.accountId,
        label: account.label,
        sublabel: account.userEmail ?? '',
      })),
    },
  ]
}

export function buildPosthogCredentialSections(
  integrations: AgentCredentialOptions['posthogIntegrations'],
): CredentialSection[] {
  if (integrations.length === 0) return []

  return [
    {
      id: 'posthog',
      provider: 'posthog' as const,
      title: 'PostHog',
      items: integrations.map((integration) => ({
        id: integration.integrationId,
        label: integration.label,
        sublabel:
          integration.projects.map((project) => project.name).join(', ') || integration.apiBaseUrl,
      })),
    },
  ]
}

export function buildTailscaleCredentialSections(
  clients: AgentCredentialOptions['tailscaleClients'],
): CredentialSection[] {
  if (clients.length === 0) return []

  return [
    {
      id: 'tailscale',
      provider: 'tailscale' as const,
      title: 'Tailscale',
      items: clients.map((client) => ({
        id: client.clientId,
        label: client.label,
        sublabel: client.oauthClientId,
      })),
    },
  ]
}
