import { api } from '../../api'
import { t } from '../../i18n/index.ts'

import type { ConnectorInfoLoaders } from './types'

export const cloudLoaders: ConnectorInfoLoaders = {
  discord: async (teamId) => {
    const connection = await api.atlasGetDiscordConnection(teamId)
    const { installation } = connection

    if (!installation) return null

    return {
      name: installation.guildName,
      fields: [
        { label: t('Server'), value: installation.guildName },
        { label: t('Server ID'), value: installation.guildId, mono: true },
        {
          label: t('Your account'),
          value: connection.linkedDiscordUsername
            ? `@${connection.linkedDiscordUsername}`
            : (connection.linkedDiscordUserId ?? t('Not linked')),
        },
        { label: t('Enabled channels'), value: String(connection.channels.length) },
        {
          label: t('Channel access'),
          value: t('Use /nuphos enable or /nuphos disable in Discord.'),
        },
      ],
      externalUrl: `https://discord.com/channels/${encodeURIComponent(installation.guildId)}`,
      externalLabel: t('Open {name}', { name: 'Discord' }),
    }
  },
  slack: async (teamId) => {
    const { installation } = await api.atlasGetSlackInstallation(teamId)

    // No installation still renders the settings view: the team may have
    // channel-scoped access through mappings served by other workspaces.
    return {
      name: installation?.slackTeamName ?? 'Slack',
      fields: installation
        ? [
            { label: t('Workspace'), value: installation.slackTeamName },
            { label: t('Workspace ID'), value: installation.slackTeamId, mono: true },
            { label: t('Bot user ID'), value: installation.botUserId, mono: true },
            { label: t('OAuth scope'), value: installation.scope, mono: true },
            { label: t('Connected'), value: new Date(installation.createdAt).toLocaleString() },
          ]
        : [{ label: t('Access'), value: t('Linked channels from another Slack workspace') }],
      externalUrl: installation
        ? `https://app.slack.com/client/${encodeURIComponent(installation.slackTeamId)}`
        : null,
      externalLabel: t('Open {name}', { name: 'Slack' }),
    }
  },
  lark: async (teamId) => {
    const { installation } = await api.atlasGetLarkInstallation(teamId)

    if (!installation) return null

    return {
      name: installation.tenantName ?? installation.appId,
      fields: [
        { label: t('Tenant'), value: installation.tenantName ?? installation.appId },
        { label: t('App ID'), value: installation.appId, mono: true },
        { label: t('Domain'), value: installation.domain === 'feishu' ? 'Feishu' : 'Lark' },
        { label: t('Connected'), value: new Date(installation.createdAt).toLocaleString() },
      ],
      externalUrl: null,
      externalLabel: '',
    }
  },
  tailscale: async (teamId, connectorId) => {
    const item = (await api.atlasListTailscaleClients(teamId)).find((row) => row.id === connectorId)

    if (!item) return null

    return {
      name: item.label,
      fields: [
        { label: t('Label'), value: item.label },
        { label: t('OAuth client ID'), value: item.clientId, mono: true },
        ...(item.createdAt
          ? [{ label: t('Connected'), value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: t('Connector ID'), value: item.id, mono: true },
      ],
      externalUrl: 'https://login.tailscale.com/admin',
      externalLabel: t('Open {name}', { name: 'Tailscale' }),
      tailscaleSandboxAccess: item.sandboxAccess ?? null,
    }
  },
  linode: async (teamId, connectorId) => {
    const item = (await api.atlasListLinodeAccounts(teamId)).find((row) => row.id === connectorId)

    if (!item) return null

    return {
      name: item.label,
      fields: [
        { label: t('Label'), value: item.label },
        { label: t('Auth'), value: t('Personal access token') },
        ...(item.createdAt
          ? [{ label: t('Connected'), value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: t('Connector ID'), value: item.id, mono: true },
      ],
      externalUrl: 'https://cloud.linode.com',
      externalLabel: t('Open {name}', { name: 'Linode' }),
    }
  },
  hetzner: async (teamId, connectorId) => {
    const item = (await api.atlasListHetznerAccounts(teamId)).find((row) => row.id === connectorId)

    if (!item) return null

    return {
      name: item.label,
      fields: [
        { label: t('Label'), value: item.label },
        { label: t('Auth'), value: t('API token') },
        ...(item.createdAt
          ? [{ label: t('Connected'), value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: t('Connector ID'), value: item.id, mono: true },
      ],
      externalUrl: 'https://console.hetzner.cloud',
      externalLabel: t('Open {name}', { name: 'Hetzner' }),
    }
  },
  tencent: async (teamId, connectorId) => {
    const item = (await api.atlasListTencentAccounts(teamId)).find((row) => row.id === connectorId)

    if (!item) return null

    return {
      name: item.label,
      fields: [
        { label: t('Label'), value: item.label },
        {
          label: t('Site'),
          value: item.site === 'international' ? t('International') : t('China'),
        },
        { label: t('Role ARN'), value: item.roleArn, mono: true },
        ...(item.createdAt
          ? [{ label: t('Connected'), value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: t('Connector ID'), value: item.id, mono: true },
      ],
      externalUrl:
        item.site === 'international'
          ? 'https://console.tencentcloud.com'
          : 'https://console.cloud.tencent.com',
      externalLabel: t('Open {name}', { name: 'Tencent Cloud' }),
    }
  },
  azure: async (teamId, connectorId) => {
    const item = (await api.atlasListAzureAccounts(teamId)).find(
      (row) => row.id === connectorId || row.subscriptionId === connectorId,
    )

    if (!item) return null

    return {
      name: item.label,
      fields: [
        { label: t('Label'), value: item.label },
        ...(item.purpose === 'permission-admin'
          ? [
              {
                label: t('Type'),
                value: t('Retired connection (remove and reconnect to use with the agent)'),
              },
            ]
          : []),
        { label: t('Tenant ID'), value: item.tenantId, mono: true },
        { label: t('Client ID'), value: item.clientId, mono: true },
        { label: t('Subscription ID'), value: item.subscriptionId, mono: true },
        ...(item.createdAt
          ? [{ label: t('Connected'), value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: t('Connector ID'), value: item.id, mono: true },
      ],
      externalUrl: 'https://portal.azure.com',
      externalLabel: t('Open {name}', { name: 'Azure Portal' }),
    }
  },
  aliyun: async (teamId, connectorId) => {
    const item = (await api.atlasListAliyunAccounts(teamId)).find((row) => row.id === connectorId)

    if (!item) return null

    return {
      name: item.label,
      fields: [
        { label: t('Label'), value: item.label },
        {
          label: t('Site'),
          value: item.site === 'international' ? t('International') : t('China'),
        },
        { label: t('Role ARN'), value: item.roleArn, mono: true },
        ...(item.createdAt
          ? [{ label: t('Connected'), value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: t('Connector ID'), value: item.id, mono: true },
      ],
      externalUrl: 'https://home.console.aliyun.com',
      externalLabel: t('Open {name}', { name: 'Alibaba Cloud' }),
    }
  },
  huawei: async (teamId, connectorId) => {
    const item = (await api.atlasListHuaweiAccounts(teamId)).find((row) => row.id === connectorId)

    if (!item) return null

    return {
      name: item.label,
      fields: [
        { label: t('Label'), value: item.label },
        { label: t('Account ID'), value: item.domainId, mono: true },
        { label: t('Identity provider'), value: item.idpId, mono: true },
        { label: t('Trust agency'), value: item.agencyName, mono: true },
        ...(item.createdAt
          ? [{ label: t('Connected'), value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: t('Connector ID'), value: item.id, mono: true },
      ],
      externalUrl: 'https://console.huaweicloud.com',
      externalLabel: t('Open {name}', { name: 'Huawei Cloud' }),
    }
  },
  volcengine: async (teamId, connectorId) => {
    const item = (await api.atlasListVolcengineAccounts(teamId)).find(
      (row) => row.id === connectorId,
    )

    if (!item) return null

    return {
      name: item.label,
      fields: [
        { label: t('Label'), value: item.label },
        { label: t('Role TRN'), value: item.roleTrn, mono: true },
        ...(item.createdAt
          ? [{ label: t('Connected'), value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: t('Connector ID'), value: item.id, mono: true },
      ],
      externalUrl: 'https://console.volcengine.com',
      externalLabel: t('Open {name}', { name: 'Volcengine' }),
    }
  },
}
