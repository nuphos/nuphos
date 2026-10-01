import { api } from '../../api'
import { databaseEngineLabel } from '../../lib/databaseEngine'
import { isDatabaseEngineReleased } from '../../lib/databaseRelease'

import { awsRoleName } from './team-home-bind'

import type { IntegrationPlatformRow, OpenConnectorInfo } from './team-home-bind'
import type {
  AwsAccount,
  BetterStackIntegration,
  CloudflareAccount,
  DatabaseConnection,
  GcpProject,
  HetznerAccount,
  LinodeAccount,
  OnpremCluster,
  TailscaleOAuthClient,
  UptimeKumaInstance,
  ZeaburProvider,
} from '../../types'

export function buildCloudConnectorRows({
  teamId,
  awsAccounts,
  gcpProjects,
  cloudflareAccounts,
  linodeAccounts,
  hetznerAccounts,
  onpremClusters,
  betterStackIntegrations,
  databaseConnections,
  uptimeKumaInstances,
  tailscaleClients,
  zeaburProviders,
  onManageOnpremAccess,
  onOpenConnectorInfo,
}: {
  teamId: string
  awsAccounts: AwsAccount[]
  gcpProjects: GcpProject[]
  cloudflareAccounts: CloudflareAccount[]
  linodeAccounts: LinodeAccount[]
  hetznerAccounts: HetznerAccount[]
  onpremClusters: OnpremCluster[]
  betterStackIntegrations: BetterStackIntegration[]
  databaseConnections: DatabaseConnection[]
  uptimeKumaInstances: UptimeKumaInstance[]
  tailscaleClients: TailscaleOAuthClient[]
  zeaburProviders: ZeaburProvider[]
  onManageOnpremAccess: (cluster: OnpremCluster) => void
  onOpenConnectorInfo: OpenConnectorInfo
}): IntegrationPlatformRow[] {
  const awsAccountRows = Array.from(
    awsAccounts.reduce((map, role) => {
      const existing = map.get(role.accountId)

      if (existing) {
        existing.roles.push(role)
      } else {
        map.set(role.accountId, { accountId: role.accountId, alias: role.alias, roles: [role] })
      }

      return map
    }, new Map<string, { accountId: string; alias?: string; roles: AwsAccount[] }>()),
  ).map(([, account]) => account)
  const gcpProjectRows = Array.from(
    gcpProjects.reduce((map, serviceAccount) => {
      const existing = map.get(serviceAccount.projectId)

      if (existing) {
        existing.serviceAccounts.push(serviceAccount)
      } else {
        map.set(serviceAccount.projectId, {
          projectId: serviceAccount.projectId,
          alias: serviceAccount.alias,
          serviceAccounts: [serviceAccount],
        })
      }

      return map
    }, new Map<string, { projectId: string; alias?: string; serviceAccounts: GcpProject[] }>()),
  ).map(([, project]) => project)

  return [
    ...awsAccountRows.map((account) => ({
      key: `aws:${account.accountId}`,
      provider: 'aws' as const,
      account: account.alias ?? account.accountId,
      principal:
        account.roles.length === 1
          ? awsRoleName(account.roles[0].roleArn)
          : `${String(account.roles.length)} roles`,
      status: 'AWS account',
      onAction: () =>
        onOpenConnectorInfo({
          provider: 'aws',
          connectorId: account.accountId,
          name: account.alias ?? account.accountId,
        }),
      onDelete: async () => {
        for (const role of account.roles) {
          await api.atlasUnbindAwsAccount(teamId, account.accountId, role.roleId)
        }
      },
    })),
    ...gcpProjectRows.map((project) => ({
      key: `gcp:${project.projectId}`,
      provider: 'gcp' as const,
      account: project.alias ?? project.projectId,
      principal:
        project.serviceAccounts.length === 1
          ? project.serviceAccounts[0].serviceAccountEmail
          : `${String(project.serviceAccounts.length)} service accounts`,
      status: 'GCP project',
      onAction: () =>
        onOpenConnectorInfo({
          provider: 'gcp',
          connectorId: project.projectId,
          name: project.alias ?? project.projectId,
        }),
      onDelete: async () => {
        for (const serviceAccount of project.serviceAccounts) {
          await api.atlasUnbindGcpProject(
            teamId,
            project.projectId,
            serviceAccount.serviceAccountId,
          )
        }
      },
    })),
    ...cloudflareAccounts.map((account) => ({
      key: `cloudflare:${account.accountId}`,
      provider: 'cloudflare' as const,
      account: account.accountName ?? account.accountId,
      principal: account.accountId,
      status: 'Cloudflare account',
      onAction: () =>
        onOpenConnectorInfo({
          provider: 'cloudflare',
          connectorId: account.accountId,
          name: account.accountName ?? account.accountId,
        }),
      onDelete: () => api.atlasUnbindCloudflareAccount(teamId, account.accountId),
    })),
    ...linodeAccounts.map((account) => ({
      key: `linode:${account.id}`,
      provider: 'linode' as const,
      account: account.label,
      principal: 'Personal access token',
      status: 'Linode account',
      onAction: () =>
        onOpenConnectorInfo({ provider: 'linode', connectorId: account.id, name: account.label }),
      onDelete: () => api.atlasUnbindLinodeAccount(teamId, account.id),
    })),
    ...hetznerAccounts.map((account) => ({
      key: `hetzner:${account.id}`,
      provider: 'hetzner' as const,
      account: account.label,
      principal: 'API token',
      status: 'Hetzner account',
      onAction: () =>
        onOpenConnectorInfo({ provider: 'hetzner', connectorId: account.id, name: account.label }),
      onDelete: () => api.atlasUnbindHetznerAccount(teamId, account.id),
    })),
    ...onpremClusters.map((cluster) => ({
      key: `onprem-k8s:${cluster.id}`,
      provider: 'onprem-k8s' as const,
      account: cluster.label,
      principal: cluster.contextName,
      status: cluster.hasCredential ? 'Kubernetes' : 'Access credential required',
      onAction: () =>
        onOpenConnectorInfo({
          provider: 'onprem-k8s',
          connectorId: cluster.id,
          name: cluster.label,
        }),
      onManageAccess: () => onManageOnpremAccess(cluster),
      onDelete: () => api.atlasDeleteOnpremCluster(teamId, cluster.id),
    })),
    ...betterStackIntegrations.map((integration) => ({
      key: `betterstack:${integration.id}`,
      provider: 'betterstack' as const,
      account: integration.label,
      principal: [
        integration.hasUptimeApiToken ? 'Uptime' : null,
        integration.hasTelemetryApiToken ? 'Telemetry' : null,
      ]
        .filter(Boolean)
        .join(' + '),
      status: 'Better Stack integration',
      onAction: () =>
        onOpenConnectorInfo({
          provider: 'betterstack',
          connectorId: integration.id,
          name: integration.label,
        }),
      onDelete: () => api.atlasUnbindBetterStackIntegration(teamId, integration.id),
    })),
    ...databaseConnections
      .filter((connection) => isDatabaseEngineReleased(connection.engine))
      .map((connection) => ({
        key: `database:${connection.id}`,
        provider: 'mongodb' as const,
        account: connection.name,
        principal: connection.endpoint,
        status: `${databaseEngineLabel(connection.engine)} connection`,
        onAction: () =>
          onOpenConnectorInfo({
            provider: 'mongodb',
            connectorId: connection.id,
            name: connection.name,
          }),
        onDelete: () => api.atlasDeleteDatabaseConnection(teamId, connection.id),
      })),
    ...uptimeKumaInstances.map((instance) => ({
      key: `uptime-kuma:${instance.id}`,
      provider: 'uptime-kuma' as const,
      account: instance.label,
      principal:
        instance.authType === 'token' ? 'Auth token' : instance.username || 'Username/password',
      status: instance.baseUrl.replace(/^https?:\/\//, ''),
      onAction: () =>
        onOpenConnectorInfo({
          provider: 'uptime-kuma',
          connectorId: instance.id,
          name: instance.label,
        }),
      onDelete: () => api.atlasUnbindUptimeKumaInstance(teamId, instance.id),
    })),
    ...tailscaleClients.map((client) => ({
      key: `tailscale:${client.id}`,
      provider: 'tailscale' as const,
      account: client.label,
      principal: client.clientId,
      status: 'Tailscale OAuth client',
      onAction: () =>
        onOpenConnectorInfo({ provider: 'tailscale', connectorId: client.id, name: client.label }),
      onDelete: () => api.atlasUnbindTailscaleClient(teamId, client.id),
    })),
    ...zeaburProviders.map((provider) => ({
      key: `zeabur:${provider.zeaburId}`,
      provider: 'zeabur' as const,
      account: provider.name,
      principal: provider.zeaburId,
      status: provider.kind === 'team' ? 'Zeabur team' : 'Zeabur user',
      onAction: () =>
        onOpenConnectorInfo({
          provider: 'zeabur',
          connectorId: provider.zeaburId,
          name: provider.name,
        }),
      onDelete: () => api.atlasUnbindZeaburProvider(teamId, provider.zeaburId),
    })),
  ]
}
