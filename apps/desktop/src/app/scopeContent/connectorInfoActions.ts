import { DEFAULT_LINEAR_NAV, LINEAR_PAGE_KEY } from '../../lib/linearNav'
import { buildCloudConnectorRows } from '../../views/cloud/team-home-rows-cloud'
import { buildDevConnectorRows } from '../../views/cloud/team-home-rows-dev'
import { buildSaasConnectorRows } from '../../views/cloud/team-home-rows-saas'
import { DEFAULT_GITLAB_NAV } from '../../views/gitlabNav'

import type { ScopeRenderContext } from './context'
import type { ConnectorInfoAction } from '../../views/connector-info/ConnectorInfoPage'

const primary = (label: string, onOpen: () => void): ConnectorInfoAction => ({
  label,
  onOpen,
  kind: 'primary',
})

const secondary = (label: string, onOpen: () => void): ConnectorInfoAction => ({
  label,
  onOpen,
})

export function connectorInfoActions(
  ctx: ScopeRenderContext,
  connectorId: string,
): ConnectorInfoAction[] {
  const { connectorDetail, scope } = ctx

  if (!connectorDetail || scope.kind !== 'team') return []

  switch (connectorDetail.provider) {
    case 'aws':
      return [
        primary('View resources', () => ctx.onOpenAwsAccountResources(connectorId)),
        secondary('Access settings', () => ctx.onOpenAwsAccountRoles(connectorId)),
      ]
    case 'gcp':
      return [
        primary('View resources', () => ctx.onOpenGcpProjectResources(connectorId)),
        secondary('Access settings', () => ctx.onOpenGcpProjectServiceAccounts(connectorId)),
      ]
    case 'cloudflare':
      return [
        primary('View resources', () => ctx.onOpenCloudflareAccountResources(connectorId)),
        secondary('Access settings', () => ctx.onOpenCloudflareAccountIam(connectorId)),
      ]
    case 'mongodb':
      return [
        primary('View resources', () => ctx.onOpenDatabaseConnectionOverview(connectorId)),
        secondary('Access settings', () => ctx.onOpenDatabaseConnection(connectorId)),
      ]
    case 'onprem-k8s': {
      const cluster = ctx.accounts?.onprem.find((item) => item.id === connectorId)

      if (!cluster?.hasCredential) return []

      return [
        primary('View resources', () =>
          ctx.enterCluster({
            teamId: scope.teamId,
            parentKind: 'onprem-cluster',
            parentId: cluster.id,
            cluster,
          }),
        ),
      ]
    }
    case 'azure':
      return [secondary('Access settings', () => ctx.onOpenAzureSubscriptionApps(connectorId))]
    case 'linode':
      return [primary('View resources', () => ctx.onOpenLinodeAccount(connectorId))]
    case 'hetzner':
      return [primary('View resources', () => ctx.onOpenHetznerAccount(connectorId))]
    case 'tencent':
      return [primary('View resources', () => ctx.onOpenTencentAccount(connectorId))]
    case 'aliyun':
      return [primary('View resources', () => ctx.onOpenAliyunAccount(connectorId))]
    case 'volcengine':
      return [primary('View resources', () => ctx.onOpenVolcengineAccount(connectorId))]
    case 'betterstack':
      return [primary('View monitors', () => ctx.onOpenBetterStackIntegration(connectorId))]
    case 'uptime-kuma':
      return [primary('View monitors', () => ctx.onOpenUptimeKumaInstance(connectorId))]
    case 'tailscale':
      return [primary('View devices', () => ctx.onOpenTailscaleClient(connectorId))]
    case 'zeabur':
      return [primary('View projects', () => ctx.onOpenZeaburProvider(connectorId))]
    case 'github': {
      const installation = ctx.githubInstallations.find(
        (item) => String(item.installationId) === connectorId,
      )

      if (!installation) return []

      return [
        primary('View repositories', () => {
          ctx.setGithubNav({ view: 'repos', installation })
          ctx.setRepoProvider('github')
          ctx.onSelectActive('team.repository')
        }),
      ]
    }
    case 'gitlab': {
      const binding = ctx.gitlabBindings.find((item) => item.id === connectorId)

      return [
        primary('View projects', () => {
          ctx.setRepoProvider('gitlab')
          ctx.setGitlabNav(binding ? { view: 'projects', binding } : DEFAULT_GITLAB_NAV)
          ctx.onSelectActive('team.repository')
        }),
      ]
    }
    case 'grafana': {
      const instance = ctx.grafanaInstances.find((item) => item.id === connectorId)

      if (!instance) return []

      return [
        primary('View dashboards', () => {
          ctx.setGrafanaInstance({
            id: instance.id,
            name: instance.name,
            url: instance.grafanaUrl,
          })
          ctx.onSelectActive('observability.dashboards')
        }),
      ]
    }
    case 'linear':
      return [
        primary('View teams', () => {
          ctx.setLinearNav(DEFAULT_LINEAR_NAV)
          ctx.onSelectActive(LINEAR_PAGE_KEY)
        }),
      ]
    case 'huawei':
    case 'notion':
    case 'upstash':
    case 'resend':
    case 'jira':
    case 'asana':
    case 'sentry':
    case 'posthog':
    case 'vanta':
    case 'secureframe':
    case 'sonarqube':
    case 'discord':
    case 'slack':
    case 'lark':
    default:
      return []
  }
}

export function connectorInfoDisconnectAction(
  ctx: ScopeRenderContext,
  connectorId: string,
): (() => Promise<void>) | undefined {
  const { accounts, connectorDetail, databaseConnections, scope } = ctx

  if (!accounts || !connectorDetail || scope.kind !== 'team') return undefined

  const ignoreOpen = () => {}
  const rows = [
    ...buildCloudConnectorRows({
      teamId: scope.teamId,
      awsAccounts: accounts.aws,
      gcpProjects: accounts.gcp,
      cloudflareAccounts: accounts.cloudflare,
      linodeAccounts: accounts.linode,
      hetznerAccounts: accounts.hetzner,
      onpremClusters: accounts.onprem,
      betterStackIntegrations: accounts.betterstack,
      databaseConnections: databaseConnections ?? [],
      uptimeKumaInstances: accounts.uptimeKuma,
      tailscaleClients: accounts.tailscale,
      zeaburProviders: accounts.zeabur,
      onManageOnpremAccess: ignoreOpen,
      onOpenConnectorInfo: ignoreOpen,
    }),
    ...buildSaasConnectorRows({
      teamId: scope.teamId,
      vantaIntegrations: accounts.vanta,
      secureframeIntegrations: accounts.secureframe,
      sonarqubeIntegrations: accounts.sonarqube,
      notionIntegrations: accounts.notion,
      upstashAccounts: accounts.upstash,
      resendIntegrations: accounts.resend,
      tencentAccounts: accounts.tencent,
      aliyunAccounts: accounts.aliyun,
      volcengineAccounts: accounts.volcengine,
      huaweiAccounts: accounts.huawei,
      azureAccounts: accounts.azure,
      onOpenConnectorInfo: ignoreOpen,
    }),
    ...buildDevConnectorRows({
      teamId: scope.teamId,
      githubInstallations: ctx.githubInstallations,
      gitlabBindings: ctx.gitlabBindings,
      linearWorkspaces: accounts.linear,
      jiraSites: accounts.jira,
      asanaAccounts: accounts.asana,
      sentryAccounts: accounts.sentry,
      posthogIntegrations: accounts.posthog,
      grafanaInstances: ctx.grafanaInstances,
      discordConnection: accounts.discordConnection,
      slackInstallation: accounts.slackInstallation,
      slackLinkedChannels: accounts.slackLinkedChannels,
      larkInstallation: accounts.larkInstallation,
      onOpenConnectorInfo: ignoreOpen,
    }),
  ]
  const rowProvider = connectorDetail.provider === 'mongodb' ? 'database' : connectorDetail.provider

  return rows.find((row) => row.key === `${rowProvider}:${connectorId}`)?.onDelete
}
