import { api } from '../../api'
import { t } from '../../i18n/index.ts'
import { databaseEngineLabel } from '../../lib/databaseEngine'

import type { ConnectorInfoLoaders } from './types'
import type { GcpProject } from '../../types'

export function gcpConnectorInfo(
  projects: GcpProject[],
  connectorId: string,
): Awaited<ReturnType<NonNullable<ConnectorInfoLoaders['gcp']>>> {
  const first = projects.find((row) => row.projectId === connectorId)

  if (!first) return null
  const serviceAccounts = projects.filter((row) => row.projectId === connectorId)

  return {
    name: first.alias ?? first.projectId,
    fields: [
      { label: t('Project'), value: first.alias ?? first.projectId },
      { label: t('Project ID'), value: first.projectId, mono: true },
      { label: t('Service accounts'), value: String(serviceAccounts.length) },
      ...(serviceAccounts.length === 1
        ? [
            {
              label: t('Principal'),
              value: first.serviceAccountEmail,
              mono: true,
            },
          ]
        : []),
      ...(first.createdAt
        ? [{ label: t('Connected'), value: new Date(first.createdAt).toLocaleString() }]
        : []),
    ],
    externalUrl: `https://console.cloud.google.com/home/dashboard?project=${encodeURIComponent(first.projectId)}`,
    externalLabel: t('Open {name}', { name: 'Google Cloud' }),
  }
}

export const infrastructureLoaders: ConnectorInfoLoaders = {
  aws: async (teamId, connectorId) => {
    const accounts = await api.atlasListAwsAccounts(teamId)
    const first = accounts.find((row) => row.accountId === connectorId)

    if (!first) return null
    const roles = accounts.filter((row) => row.accountId === connectorId)

    return {
      name: first.alias ?? first.accountId,
      fields: [
        { label: t('Account'), value: first.alias ?? first.accountId },
        { label: t('Account ID'), value: first.accountId, mono: true },
        { label: t('Roles'), value: String(roles.length) },
        ...(roles.length === 1 ? [{ label: t('Role ARN'), value: first.roleArn, mono: true }] : []),
        ...(first.createdAt
          ? [{ label: t('Connected'), value: new Date(first.createdAt).toLocaleString() }]
          : []),
      ],
      externalUrl: 'https://console.aws.amazon.com',
      externalLabel: t('Open {name}', { name: 'AWS Console' }),
    }
  },
  gcp: async (teamId, connectorId) => {
    const projects = await api.atlasListGcpProjects(teamId)

    return gcpConnectorInfo(projects, connectorId)
  },
  cloudflare: async (teamId, connectorId) => {
    const item = (await api.atlasListCloudflareAccounts(teamId)).find(
      (row) => row.accountId === connectorId,
    )

    if (!item) return null

    return {
      name: item.accountName ?? item.accountId,
      fields: [
        { label: t('Account'), value: item.accountName ?? item.accountId },
        { label: t('Account ID'), value: item.accountId, mono: true },
        { label: t('Auth'), value: item.authType === 'oauth' ? 'OAuth' : t('API token') },
        ...(item.createdAt
          ? [{ label: t('Connected'), value: new Date(item.createdAt).toLocaleString() }]
          : []),
      ],
      externalUrl: `https://dash.cloudflare.com/${encodeURIComponent(item.accountId)}`,
      externalLabel: t('Open {name}', { name: 'Cloudflare' }),
    }
  },
  mongodb: async (teamId, connectorId) => {
    const item = (await api.atlasListDatabaseConnections(teamId)).find(
      (row) => row.id === connectorId,
    )

    if (!item) return null

    return {
      name: item.name,
      fields: [
        { label: t('Name'), value: item.name },
        { label: t('Engine'), value: databaseEngineLabel(item.engine) },
        { label: t('Environment'), value: item.environment.length > 0 ? item.environment : '—' },
        { label: t('Endpoint'), value: item.endpoint, mono: true },
        { label: t('Agent access'), value: item.agentPolicy.replaceAll('-', ' ') },
        { label: t('Connected'), value: new Date(item.createdAt).toLocaleString() },
        { label: t('Connector ID'), value: item.id, mono: true },
      ],
      externalUrl: null,
      externalLabel: '',
    }
  },
  'onprem-k8s': async (teamId, connectorId) => {
    const { clusters } = await api.atlasListOnpremClusters(teamId)
    const item = clusters.find((row) => row.id === connectorId)

    if (!item) return null

    return {
      name: item.label,
      fields: [
        { label: t('Name'), value: item.label },
        { label: t('Context'), value: item.contextName, mono: true },
        { label: t('Endpoint'), value: item.endpoint ?? t('Outbound relay') },
        { label: t('Credential'), value: item.hasCredential ? t('Configured') : t('Required') },
        ...(item.createdAt
          ? [{ label: t('Connected'), value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: t('Connector ID'), value: item.id, mono: true },
      ],
      externalUrl: null,
      externalLabel: '',
    }
  },
}
