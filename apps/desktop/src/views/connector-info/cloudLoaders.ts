import { api } from '../../api'

import type { ConnectorInfoLoaders } from './types'

export const cloudLoaders: ConnectorInfoLoaders = {
  discord: async (teamId) => {
    const connection = await api.atlasGetDiscordConnection(teamId)
    const { installation } = connection

    if (!installation) return null

    return {
      name: installation.guildName,
      fields: [
        { label: 'Server', value: installation.guildName },
        { label: 'Server ID', value: installation.guildId, mono: true },
        { label: 'Your account', value: connection.linkedDiscordUserId ?? 'Not linked' },
        { label: 'Enabled channels', value: String(connection.channels.length) },
        { label: 'Channel access', value: 'Use /nuphos enable or /nuphos disable in Discord.' },
      ],
      externalUrl: `https://discord.com/channels/${encodeURIComponent(installation.guildId)}`,
      externalLabel: 'Open Discord',
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
            { label: 'Workspace', value: installation.slackTeamName },
            { label: 'Workspace ID', value: installation.slackTeamId, mono: true },
            { label: 'Bot user ID', value: installation.botUserId, mono: true },
            { label: 'OAuth scope', value: installation.scope, mono: true },
            { label: 'Connected', value: new Date(installation.createdAt).toLocaleString() },
          ]
        : [{ label: 'Access', value: 'Linked channels from another Slack workspace' }],
      externalUrl: installation
        ? `https://app.slack.com/client/${encodeURIComponent(installation.slackTeamId)}`
        : null,
      externalLabel: 'Open Slack',
    }
  },
  lark: async (teamId) => {
    const { installation } = await api.atlasGetLarkInstallation(teamId)

    if (!installation) return null

    return {
      name: installation.tenantName ?? installation.appId,
      fields: [
        { label: 'Tenant', value: installation.tenantName ?? installation.appId },
        { label: 'App ID', value: installation.appId, mono: true },
        { label: 'Domain', value: installation.domain === 'feishu' ? 'Feishu' : 'Lark' },
        { label: 'Connected', value: new Date(installation.createdAt).toLocaleString() },
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
        { label: 'Label', value: item.label },
        { label: 'OAuth client ID', value: item.clientId, mono: true },
        ...(item.createdAt
          ? [{ label: 'Connected', value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: 'Connector ID', value: item.id, mono: true },
      ],
      externalUrl: 'https://login.tailscale.com/admin',
      externalLabel: 'Open Tailscale',
      tailscaleSandboxAccess: item.sandboxAccess ?? null,
    }
  },
  linode: async (teamId, connectorId) => {
    const item = (await api.atlasListLinodeAccounts(teamId)).find((row) => row.id === connectorId)

    if (!item) return null

    return {
      name: item.label,
      fields: [
        { label: 'Label', value: item.label },
        { label: 'Auth', value: 'Personal access token' },
        ...(item.createdAt
          ? [{ label: 'Connected', value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: 'Connector ID', value: item.id, mono: true },
      ],
      externalUrl: 'https://cloud.linode.com',
      externalLabel: 'Open Linode',
    }
  },
  hetzner: async (teamId, connectorId) => {
    const item = (await api.atlasListHetznerAccounts(teamId)).find((row) => row.id === connectorId)

    if (!item) return null

    return {
      name: item.label,
      fields: [
        { label: 'Label', value: item.label },
        { label: 'Auth', value: 'API token' },
        ...(item.createdAt
          ? [{ label: 'Connected', value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: 'Connector ID', value: item.id, mono: true },
      ],
      externalUrl: 'https://console.hetzner.cloud',
      externalLabel: 'Open Hetzner',
    }
  },
  tencent: async (teamId, connectorId) => {
    const item = (await api.atlasListTencentAccounts(teamId)).find((row) => row.id === connectorId)

    if (!item) return null

    return {
      name: item.label,
      fields: [
        { label: 'Label', value: item.label },
        {
          label: 'Site',
          value: item.site === 'international' ? 'International' : 'China',
        },
        { label: 'Role ARN', value: item.roleArn, mono: true },
        ...(item.createdAt
          ? [{ label: 'Connected', value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: 'Connector ID', value: item.id, mono: true },
      ],
      externalUrl:
        item.site === 'international'
          ? 'https://console.tencentcloud.com'
          : 'https://console.cloud.tencent.com',
      externalLabel: 'Open Tencent Cloud',
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
        { label: 'Label', value: item.label },
        ...(item.purpose === 'permission-admin'
          ? [
              {
                label: 'Type',
                value: 'Retired connection (remove and reconnect to use with the agent)',
              },
            ]
          : []),
        { label: 'Tenant ID', value: item.tenantId, mono: true },
        { label: 'Client ID', value: item.clientId, mono: true },
        { label: 'Subscription ID', value: item.subscriptionId, mono: true },
        ...(item.createdAt
          ? [{ label: 'Connected', value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: 'Connector ID', value: item.id, mono: true },
      ],
      externalUrl: 'https://portal.azure.com',
      externalLabel: 'Open Azure Portal',
    }
  },
  aliyun: async (teamId, connectorId) => {
    const item = (await api.atlasListAliyunAccounts(teamId)).find((row) => row.id === connectorId)

    if (!item) return null

    return {
      name: item.label,
      fields: [
        { label: 'Label', value: item.label },
        {
          label: 'Site',
          value: item.site === 'international' ? 'International' : 'China',
        },
        { label: 'Role ARN', value: item.roleArn, mono: true },
        ...(item.createdAt
          ? [{ label: 'Connected', value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: 'Connector ID', value: item.id, mono: true },
      ],
      externalUrl: 'https://home.console.aliyun.com',
      externalLabel: 'Open Alibaba Cloud',
    }
  },
  huawei: async (teamId, connectorId) => {
    const item = (await api.atlasListHuaweiAccounts(teamId)).find((row) => row.id === connectorId)

    if (!item) return null

    return {
      name: item.label,
      fields: [
        { label: 'Label', value: item.label },
        { label: 'Account ID', value: item.domainId, mono: true },
        { label: 'Identity provider', value: item.idpId, mono: true },
        { label: 'Trust agency', value: item.agencyName, mono: true },
        ...(item.createdAt
          ? [{ label: 'Connected', value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: 'Connector ID', value: item.id, mono: true },
      ],
      externalUrl: 'https://console.huaweicloud.com',
      externalLabel: 'Open Huawei Cloud',
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
        { label: 'Label', value: item.label },
        { label: 'Role TRN', value: item.roleTrn, mono: true },
        ...(item.createdAt
          ? [{ label: 'Connected', value: new Date(item.createdAt).toLocaleString() }]
          : []),
        { label: 'Connector ID', value: item.id, mono: true },
      ],
      externalUrl: 'https://console.volcengine.com',
      externalLabel: 'Open Volcengine',
    }
  },
}
