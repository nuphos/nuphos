import { api } from '../../api'
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
      { label: 'Project', value: first.alias ?? first.projectId },
      { label: 'Project ID', value: first.projectId, mono: true },
      { label: 'Service accounts', value: String(serviceAccounts.length) },
      ...(serviceAccounts.length === 1
        ? [
            {
              label: 'Principal',
              value: first.serviceAccountEmail,
              mono: true,
            },
          ]
        : []),
      ...(first.createdAt
        ? [{ label: 'Connected', value: new Date(first.createdAt).toLocaleString() }]
        : []),
    ],
    externalUrl: `https://console.cloud.google.com/home/dashboard?project=${encodeURIComponent(first.projectId)}`,
    externalLabel: 'Open Google Cloud',
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
        { label: 'Account', value: first.alias ?? first.accountId },
        { label: 'Account ID', value: first.accountId, mono: true },
        { label: 'Roles', value: String(roles.length) },
        ...(roles.length === 1 ? [{ label: 'Role ARN', value: first.roleArn, mono: true }] : []),
        ...(first.createdAt
          ? [{ label: 'Connected', value: new Date(first.createdAt).toLocaleString() }]
          : []),
      ],
      externalUrl: 'https://console.aws.amazon.com',
      externalLabel: 'Open AWS Console',
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
        { label: 'Account', value: item.accountName ?? item.accountId },
        { label: 'Account ID', value: item.accountId, mono: true },
        { label: 'Auth', value: item.authType === 'oauth' ? 'OAuth' : 'API token' },
        ...(item.createdAt
          ? [{ label: 'Connected', value: new Date(item.createdAt).toLocaleString() }]
          : []),
      ],
      externalUrl: `https://dash.cloudflare.com/${encodeURIComponent(item.accountId)}`,
      externalLabel: 'Open Cloudflare',
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
        { label: 'Name', value: item.name },
        { label: 'Engine', value: databaseEngineLabel(item.engine) },
        { label: 'Environment', value: item.environment.length > 0 ? item.environment : '—' },
        { label: 'Endpoint', value: item.endpoint, mono: true },
        { label: 'Agent access', value: item.agentPolicy.replaceAll('-', ' ') },
        { label: 'Connected', value: new Date(item.createdAt).toLocaleString() },
        { label: 'Connector ID', value: item.id, mono: true },
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
        { label: 'Name', value: item.label },
        { label: 'Context', value: item.contextName, mono: true },
        { label: 'Endpoint', value: item.endpoint ?? 'Outbound relay' },
        { label: 'Credential', value: item.hasCredential ? 'Configured' : 'Required' },
        ...(item.createdAt
          ? [{ label: 'Connected', value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: 'Connector ID', value: item.id, mono: true },
      ],
      externalUrl: null,
      externalLabel: '',
    }
  },
}
