import { api } from '../../api'
import { t } from '../../i18n/index.ts'
import { posthogStatusLine } from '../../types/posthog'

import type { IntegrationPlatformRow, OpenConnectorInfo } from './team-home-bind'
import type {
  DiscordConnection,
  AsanaAccount,
  GithubInstallation,
  GitlabBinding,
  GrafanaInstance,
  JiraSite,
  LarkInstallation,
  LinearWorkspace,
  PlaudAccount,
  PosthogIntegration,
  SentryAccount,
  SlackInstallation,
  SlackLinkedChannelsSummary,
} from '../../types'

export function buildDevConnectorRows({
  teamId,
  githubInstallations,
  gitlabBindings,
  linearWorkspaces,
  jiraSites,
  asanaAccounts,
  sentryAccounts,
  posthogIntegrations,
  plaudAccounts,
  grafanaInstances,
  discordConnection,
  slackInstallation,
  slackLinkedChannels,
  larkInstallation,
  onOpenConnectorInfo,
}: {
  teamId: string
  githubInstallations: GithubInstallation[]
  gitlabBindings: GitlabBinding[]
  linearWorkspaces: LinearWorkspace[]
  jiraSites: JiraSite[]
  asanaAccounts: AsanaAccount[]
  sentryAccounts: SentryAccount[]
  posthogIntegrations: PosthogIntegration[]
  plaudAccounts: PlaudAccount[]
  grafanaInstances: GrafanaInstance[]
  discordConnection?: DiscordConnection | null
  slackInstallation: SlackInstallation | null
  slackLinkedChannels: SlackLinkedChannelsSummary | null
  larkInstallation: LarkInstallation | null
  onOpenConnectorInfo: OpenConnectorInfo
}): IntegrationPlatformRow[] {
  return [
    ...githubInstallations.map((installation) => ({
      key: `github:${String(installation.installationId)}`,
      provider: 'github' as const,
      account: installation.accountLogin,
      principal:
        installation.targetType === 'all' ? t('All repositories') : t('Selected repositories'),
      status: `GitHub ${installation.accountType.toLowerCase()}`,
      onAction: () =>
        onOpenConnectorInfo({
          provider: 'github',
          connectorId: String(installation.installationId),
          name: installation.accountLogin,
        }),
      onDelete: () => api.atlasUnbindGithubInstallation(teamId, installation.installationId),
    })),
    ...gitlabBindings.map((binding) => ({
      key: `gitlab:${binding.id}`,
      provider: 'gitlab' as const,
      account: binding.displayName || binding.username,
      principal: `${binding.hostUrl.replace(/^https?:\/\//, '')}/${binding.username}`,
      status: t('GitLab account'),
      onAction: () =>
        onOpenConnectorInfo({
          provider: 'gitlab',
          connectorId: binding.id,
          name: binding.displayName || binding.username,
        }),
      onDelete: () => api.atlasUnbindGitlab(teamId, binding.id),
    })),
    ...linearWorkspaces.map((workspace) => ({
      key: `linear:${workspace.id}`,
      provider: 'linear' as const,
      account: workspace.label || workspace.workspaceName,
      principal: workspace.organizationUrlKey
        ? `linear.app/${workspace.organizationUrlKey}`
        : t('Linear workspace'),
      status: t('Linear workspace'),
      onAction: () =>
        onOpenConnectorInfo({
          provider: 'linear',
          connectorId: workspace.id,
          name: workspace.label || workspace.workspaceName,
        }),
      onDelete: () => api.atlasUnbindLinear(teamId, workspace.id),
    })),
    ...jiraSites.map((site) => ({
      key: `jira:${site.id}`,
      provider: 'jira' as const,
      account: site.label || site.siteName,
      principal: site.siteUrl ? site.siteUrl.replace(/^https?:\/\//, '') : t('Jira site'),
      status: t('Jira site'),
      onAction: () =>
        onOpenConnectorInfo({
          provider: 'jira',
          connectorId: site.id,
          name: site.label || site.siteName,
        }),
      onDelete: () => api.atlasUnbindJira(teamId, site.id),
    })),
    ...asanaAccounts.map((account) => ({
      key: `asana:${account.id}`,
      provider: 'asana' as const,
      account: account.label || account.accountName || account.accountGid,
      principal: account.accountEmail || t('Asana account'),
      status: t('Asana account'),
      onAction: () =>
        onOpenConnectorInfo({
          provider: 'asana',
          connectorId: account.id,
          name: account.label || account.accountName || account.accountGid,
        }),
      onDelete: () => api.atlasUnbindAsana(teamId, account.id),
    })),
    ...sentryAccounts.map((account) => ({
      key: `sentry:${account.id}`,
      provider: 'sentry' as const,
      account: account.label || account.userName || account.userId,
      principal: account.userEmail || t('Sentry account'),
      status: t('Sentry account'),
      onAction: () =>
        onOpenConnectorInfo({
          provider: 'sentry',
          connectorId: account.id,
          name: account.label || account.userName || account.userId,
        }),
      onDelete: () => api.atlasUnbindSentry(teamId, account.id),
    })),
    ...posthogIntegrations.map((integration) => ({
      key: `posthog:${integration.id}`,
      provider: 'posthog' as const,
      account: integration.label,
      principal: integration.userEmail || integration.apiBaseUrl.replace(/^https?:\/\//, ''),
      status: posthogStatusLine(integration),
      attention: integration.status === 'reconnect_required' ? t('Reconnect required') : undefined,
      onAction: () =>
        onOpenConnectorInfo({
          provider: 'posthog',
          connectorId: integration.id,
          name: integration.label,
        }),
      onDelete: () => api.atlasUnbindPosthogIntegration(teamId, integration.id),
    })),
    ...plaudAccounts.map((account) => ({
      key: `plaud:${account.id}`,
      provider: 'plaud' as const,
      account: account.label,
      principal: account.userEmail || account.userName || t('Plaud account'),
      status: t('Plaud account'),
      onAction: () =>
        onOpenConnectorInfo({ provider: 'plaud', connectorId: account.id, name: account.label }),
      onDelete: () => api.atlasUnbindPlaud(teamId, account.id),
    })),
    ...grafanaInstances.map((instance) => ({
      key: `grafana:${instance.id}`,
      provider: 'grafana' as const,
      account: instance.name,
      principal: instance.grafanaUrl,
      status: t('Grafana instance'),
      onAction: () =>
        onOpenConnectorInfo({ provider: 'grafana', connectorId: instance.id, name: instance.name }),
      onDelete: () => api.atlasUnbindGrafanaInstance(teamId, instance.id),
    })),
    ...(discordConnection?.installation
      ? [
          {
            key: `discord:${discordConnection.installation.guildId}`,
            provider: 'discord' as const,
            account: discordConnection.installation.guildName,
            principal: discordConnection.installation.guildId,
            status: discordConnection.linkedDiscordUserId
              ? t('{n} enabled channel(s) · Account linked', {
                  n: discordConnection.channels.length,
                })
              : t('{n} enabled channel(s) · Account not linked', {
                  n: discordConnection.channels.length,
                }),
            onAction: () =>
              onOpenConnectorInfo({
                provider: 'discord',
                connectorId: discordConnection.installation!.guildId,
                name: discordConnection.installation!.guildName,
              }),
            onDelete: () => api.atlasDisconnectDiscord(teamId),
          },
        ]
      : []),
    ...(slackInstallation
      ? [
          {
            key: `slack:${slackInstallation.id}`,
            provider: 'slack' as const,
            account: slackInstallation.slackTeamName,
            principal: slackInstallation.slackTeamId,
            status: t('Slack workspace'),
            onAction: () =>
              onOpenConnectorInfo({
                provider: 'slack',
                connectorId: slackInstallation.id,
                name: slackInstallation.slackTeamName,
              }),
            onDelete: () => api.atlasDisconnectSlack(teamId),
          },
        ]
      : (slackLinkedChannels?.count ?? 0) > 0
        ? [
            {
              key: 'slack:linked-channels',
              provider: 'slack' as const,
              account:
                slackLinkedChannels!.grantWorkspaces
                  .map((workspace) => workspace.name ?? workspace.id)
                  .join(', ') || t('Linked channels'),
              principal: t('{n} linked channel(s)', { n: slackLinkedChannels!.count }),
              status: t("Channels via another workspace's installation"),
              onAction: () =>
                onOpenConnectorInfo({
                  provider: 'slack',
                  connectorId: 'linked-channels',
                  name: 'Slack',
                }),
            },
          ]
        : []),
    ...(larkInstallation
      ? [
          {
            key: `lark:${larkInstallation.id}`,
            provider: 'lark' as const,
            account: larkInstallation.tenantName ?? larkInstallation.appId,
            principal: larkInstallation.appId,
            status: larkInstallation.domain === 'feishu' ? t('Feishu app') : t('Lark app'),
            onAction: () =>
              onOpenConnectorInfo({
                provider: 'lark',
                connectorId: larkInstallation.id,
                name: larkInstallation.tenantName ?? larkInstallation.appId,
              }),
            onDelete: () => api.atlasDisconnectLark(teamId),
          },
        ]
      : []),
  ]
}
