export type SlackChannelMapping = {
  id: string
  slackWorkspaceId: string
  slackChannelId: string
  teamId: string
  enabled: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
  // Enrichment from GET /slack/mappings: which installation serves the
  // mapping's workspace and what the mapped channel currently looks like.
  workspace?: {
    id: string
    name: string | null
    installed: boolean
    ownedByThisTeam: boolean
    ownerTeamName: string | null
  }
  channel?: {
    name: string
    isPrivate: boolean
    botInChannel: boolean
    archived: boolean
  } | null
}

export type DiscordConnection = {
  configured: boolean
  installation: { guildId: string; guildName: string } | null
  channels: { channelId: string }[]
  linkedDiscordUserId: string | null
}

export type SlackUserMapping = {
  id: string
  slackWorkspaceId: string
  slackUserId: string
  teamId: string
  nuphosUserId: string
  enabled: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
  // Included by the current-user mapping endpoint so DM destinations can
  // identify the actual Slack recipient before the user confirms the Watch.
  slackUser?: {
    id: string
    displayName: string
    matchMethod: 'email' | 'oauth_installer' | 'manual'
  } | null
}

export type SlackConnectionStatus = {
  configured: boolean
  connected: boolean
  installed?: boolean
  // True when `connected` reflects the shared, server-wide fallback bot rather
  // than this team's own per-team OAuth binding. The bot is reachable, but it is
  // not this workspace's connection — do not present it as "connected".
  legacyGlobal?: boolean
  oauthAvailable?: boolean
  botUserId?: string | null
  botName?: string
  slackWorkspaceId?: string
  slackWorkspaceName?: string
  error?: string
}

export type SlackInstallation = {
  id: string
  slackTeamId: string
  slackTeamName: string
  botUserId: string
  scope: string
  createdAt: string
}

export type SlackOAuthStart = {
  authorizeUrl: string
  state: string
  expiresAt: string
}

export type SlackChannelOption = {
  id: string
  name: string
  isPrivate: boolean
  // Present when the channel is reached through a workspace other than the
  // team's own installation (a cross-workspace channel grant).
  slackWorkspaceId?: string
}

export type LarkDomain = 'feishu' | 'larksuite'

export type LarkChatMapping = {
  id: string
  appId: string
  chatId: string
  teamId: string
  name?: string
  enabled: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type LarkAvailableChat = {
  chatId: string
  name: string
  description?: string
  linked: boolean
  enabled: boolean
}

export type LarkUserMapping = {
  id: string
  appId: string
  larkOpenId: string
  teamId: string
  nuphosUserId: string
  enabled: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type LarkPairCode = {
  code: string
  expiresAt: string
}

export type LarkBindInput = {
  appId: string
  appSecret: string
  encryptKey: string
  domain: LarkDomain
}

export type LarkInstallation = {
  id: string
  appId: string
  domain: LarkDomain
  tenantName: string | null
  createdAt: string
}

export type LarkConnectionStatus = {
  installed?: boolean
  connected: boolean
  appId?: string
  domain?: LarkDomain
  webhookUrl?: string
}
