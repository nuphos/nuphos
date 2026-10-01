import { api } from '../../api'

import { cloudLoaders } from './cloudLoaders'
import { devToolLoaders } from './devToolLoaders'
import { gcpConnectorInfo, infrastructureLoaders } from './infrastructureLoaders'

import type { ConnectorInfo, ConnectorInfoLoaders } from './types'
import type { ConnectorInfoProvider } from '../../lib/appRoutes'

const opsLoaders: ConnectorInfoLoaders = {
  betterstack: async (teamId, connectorId) => {
    const item = (await api.atlasListBetterStackIntegrations(teamId)).find(
      (row) => row.id === connectorId,
    )

    if (!item) return null

    return {
      name: item.label,
      fields: [
        { label: 'Label', value: item.label },
        {
          label: 'API tokens',
          value:
            [
              item.hasUptimeApiToken ? 'Uptime' : null,
              item.hasTelemetryApiToken ? 'Telemetry' : null,
            ]
              .filter(Boolean)
              .join(' + ') || '—',
        },
        { label: 'Connected', value: new Date(item.createdAt).toLocaleString() },
        { label: 'Connector ID', value: item.id, mono: true },
      ],
      externalUrl: 'https://uptime.betterstack.com',
      externalLabel: 'Open Better Stack',
    }
  },
  'uptime-kuma': async (teamId, connectorId) => {
    const item = (await api.atlasListUptimeKumaInstances(teamId)).find(
      (row) => row.id === connectorId,
    )

    if (!item) return null

    return {
      name: item.label,
      fields: [
        { label: 'Label', value: item.label },
        { label: 'URL', value: item.baseUrl.replace(/^https?:\/\//, ''), mono: true },
        {
          label: 'Auth',
          value: item.authType === 'token' ? 'Auth token' : item.username || 'Username/password',
        },
        { label: 'Connected', value: new Date(item.createdAt).toLocaleString() },
        { label: 'Connector ID', value: item.id, mono: true },
      ],
      externalUrl: item.baseUrl,
      externalLabel: 'Open Uptime Kuma',
    }
  },
  zeabur: async (teamId, connectorId) => {
    const item = (await api.atlasListZeaburProviders(teamId)).find(
      (row) => row.zeaburId === connectorId,
    )

    if (!item) return null

    return {
      name: item.name,
      fields: [
        { label: 'Name', value: item.name },
        { label: 'Kind', value: item.kind === 'team' ? 'Zeabur team' : 'Zeabur user' },
        { label: 'Zeabur ID', value: item.zeaburId, mono: true },
        ...(item.createdAt
          ? [{ label: 'Connected', value: new Date(item.createdAt).toLocaleString() }]
          : []),
      ],
      externalUrl: 'https://zeabur.com',
      externalLabel: 'Open Zeabur',
    }
  },
  github: async (teamId, connectorId) => {
    const item = (await api.atlasListGithubInstallations(teamId)).find(
      (row) => String(row.installationId) === connectorId,
    )

    if (!item) return null

    return {
      name: item.accountLogin,
      fields: [
        { label: 'Account', value: item.accountLogin },
        { label: 'Type', value: item.accountType },
        {
          label: 'Repositories',
          value: item.targetType === 'all' ? 'All repositories' : 'Selected repositories',
        },
        { label: 'Installation ID', value: String(item.installationId), mono: true },
        ...(item.createdAt
          ? [{ label: 'Connected', value: new Date(item.createdAt).toLocaleString() }]
          : []),
      ],
      externalUrl: `https://github.com/${item.accountLogin}`,
      externalLabel: 'Open GitHub',
    }
  },
  gitlab: async (teamId, connectorId) => {
    const item = (await api.atlasListGitlabBindings(teamId)).find((row) => row.id === connectorId)

    if (!item) return null

    return {
      name: item.displayName || item.username,
      fields: [
        { label: 'Account', value: item.displayName || item.username },
        {
          label: 'Host',
          value: `${item.hostUrl.replace(/^https?:\/\//, '')}/${item.username}`,
          mono: true,
        },
        { label: 'OAuth scope', value: item.scope, mono: true },
        { label: 'Connector ID', value: item.id, mono: true },
      ],
      externalUrl: `${item.hostUrl.replace(/\/$/, '')}/${item.username}`,
      externalLabel: 'Open GitLab',
    }
  },
  grafana: async (teamId, connectorId) => {
    const item = (await api.atlasListGrafanaInstances(teamId)).find((row) => row.id === connectorId)

    if (!item) return null

    return {
      name: item.name,
      fields: [
        { label: 'Name', value: item.name },
        { label: 'URL', value: item.grafanaUrl.replace(/^https?:\/\//, ''), mono: true },
        ...(item.createdAt
          ? [{ label: 'Connected', value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: 'Connector ID', value: item.id, mono: true },
      ],
      externalUrl: item.grafanaUrl,
      externalLabel: 'Open Grafana',
    }
  },
}

const loaders: ConnectorInfoLoaders = {
  ...infrastructureLoaders,
  ...devToolLoaders,
  ...cloudLoaders,
  ...opsLoaders,
}

export async function loadConnectorInfo(
  teamId: string,
  provider: ConnectorInfoProvider,
  connectorId: string,
): Promise<ConnectorInfo | null> {
  const loader = loaders[provider]

  return loader ? loader(teamId, connectorId) : null
}

export type LoadedConnectorInfo = { id: string; info: ConnectorInfo }

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

/**
 * A connector-info route identifies a provider, while the entries returned
 * here are that provider's individual connections. Keeping the enumeration in
 * this module also lets old /connectors/<provider>/<connection-id> deep links
 * open the same provider page and preselect their original connection.
 */
async function listConnectorIds(
  teamId: string,
  provider: ConnectorInfoProvider,
): Promise<string[]> {
  if (provider === 'posthog') {
    return (await api.atlasListPosthogIntegrations(teamId)).map((item) => item.id)
  }
  switch (provider) {
    case 'aws':
      return unique((await api.atlasListAwsAccounts(teamId)).map((item) => item.accountId))
    case 'gcp':
      return unique((await api.atlasListGcpProjects(teamId)).map((item) => item.projectId))
    case 'cloudflare':
      return unique((await api.atlasListCloudflareAccounts(teamId)).map((item) => item.accountId))
    case 'mongodb':
      return (await api.atlasListDatabaseConnections(teamId)).map((item) => item.id)
    case 'onprem-k8s':
      return (await api.atlasListOnpremClusters(teamId)).clusters.map((item) => item.id)
    case 'notion':
      return (await api.atlasListNotionIntegrations(teamId)).map((item) => item.id)
    case 'upstash':
      return (await api.atlasListUpstashAccounts(teamId)).map((item) => item.id)
    case 'resend':
      return (await api.atlasListResendIntegrations(teamId)).map((item) => item.id)
    case 'linear':
      return (await api.atlasListLinearWorkspaces(teamId)).map((item) => item.id)
    case 'jira':
      return (await api.atlasListJiraSites(teamId)).map((item) => item.id)
    case 'asana':
      return (await api.atlasListAsanaAccounts(teamId)).map((item) => item.id)
    case 'sentry':
      return (await api.atlasListSentryAccounts(teamId)).map((item) => item.id)
    case 'vanta':
      return (await api.atlasListVantaIntegrations(teamId)).map((item) => item.id)
    case 'secureframe':
      return (await api.atlasListSecureframeIntegrations(teamId)).map((item) => item.id)
    case 'sonarqube':
      return (await api.atlasListSonarqubeIntegrations(teamId)).map((item) => item.id)
    case 'tailscale':
      return (await api.atlasListTailscaleClients(teamId)).map((item) => item.id)
    case 'linode':
      return (await api.atlasListLinodeAccounts(teamId)).map((item) => item.id)
    case 'hetzner':
      return (await api.atlasListHetznerAccounts(teamId)).map((item) => item.id)
    case 'tencent':
      return (await api.atlasListTencentAccounts(teamId)).map((item) => item.id)
    case 'azure':
      return unique((await api.atlasListAzureAccounts(teamId)).map((item) => item.subscriptionId))
    case 'aliyun':
      return (await api.atlasListAliyunAccounts(teamId)).map((item) => item.id)
    case 'volcengine':
      return (await api.atlasListVolcengineAccounts(teamId)).map((item) => item.id)
    case 'huawei':
      return (await api.atlasListHuaweiAccounts(teamId)).map((item) => item.id)
    case 'betterstack':
      return (await api.atlasListBetterStackIntegrations(teamId)).map((item) => item.id)
    case 'uptime-kuma':
      return (await api.atlasListUptimeKumaInstances(teamId)).map((item) => item.id)
    case 'zeabur':
      return (await api.atlasListZeaburProviders(teamId)).map((item) => item.zeaburId)
    case 'github':
      return (await api.atlasListGithubInstallations(teamId)).map((item) =>
        String(item.installationId),
      )
    case 'gitlab':
      return (await api.atlasListGitlabBindings(teamId)).map((item) => item.id)
    case 'grafana':
      return (await api.atlasListGrafanaInstances(teamId)).map((item) => item.id)
    // These providers have one team-scoped installation rather than an ID
    // collection. Their loaders decide whether an installation is available.
    case 'discord':
    case 'slack':
    case 'lark':
      return [provider]
  }
}

export async function loadConnectorInfos(
  teamId: string,
  provider: ConnectorInfoProvider,
): Promise<LoadedConnectorInfo[]> {
  if (provider === 'gcp') {
    const projects = await api.atlasListGcpProjects(teamId)

    return unique(projects.map((item) => item.projectId)).flatMap((id) => {
      const info = gcpConnectorInfo(projects, id)

      return info ? [{ id, info }] : []
    })
  }

  const ids = await listConnectorIds(teamId, provider)
  const loaded = await Promise.all(
    ids.map(async (id) => ({ id, info: await loadConnectorInfo(teamId, provider, id) })),
  )

  return loaded.filter((item): item is LoadedConnectorInfo => item.info !== null)
}
