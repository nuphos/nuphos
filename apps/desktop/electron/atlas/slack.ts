import { call } from './client'

export type SlackChannelMapping = {
  id: string
  slackWorkspaceId: string
  slackChannelId: string
  teamId: string
  enabled: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
  /** The Bots that answer in this channel (#3702); `mine` ones the viewer may remove. */
  bots?: SlackChannelBot[]
}

export type SlackChannelBot = { sessionId: string; title?: string; avatar: string; mine?: boolean }

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
  slackUser?: {
    id: string
    displayName: string
    matchMethod: 'email' | 'oauth_installer' | 'manual'
  }
}

export type SlackOAuthStart = {
  authorizeUrl: string
  state: string
  expiresAt: string
}

export type SlackConnectionStatus = {
  configured: boolean
  connected: boolean
  installed?: boolean
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

export type SlackChannelOption = {
  id: string
  name: string
  isPrivate: boolean
}

/** The team's connected channels, and the viewer's own Bots they may bring into one. */
export async function listSlackChannelMappings(
  teamId: string,
): Promise<{ mappings: SlackChannelMapping[]; myBots: SlackChannelBot[] }> {
  const data = await call<{ mappings?: SlackChannelMapping[]; myBots?: SlackChannelBot[] }>(
    'GET',
    `/slack/mappings?teamId=${encodeURIComponent(teamId)}`,
  )

  return { mappings: data.mappings ?? [], myBots: data.myBots ?? [] }
}

/** Brings one of the viewer's Bots into a connected channel, or takes it out. */
export async function setSlackChannelBot(
  teamId: string,
  channel: { slackWorkspaceId: string; slackChannelId: string },
  botSessionId: string,
  answers: boolean,
): Promise<SlackChannelBot[]> {
  const path = `/slack/mappings/${channel.slackWorkspaceId}/${channel.slackChannelId}/bots`
  const data = await call<{ bots: SlackChannelBot[] }>(
    answers ? 'POST' : 'DELETE',
    answers
      ? path
      : `${path}/${encodeURIComponent(botSessionId)}?teamId=${encodeURIComponent(teamId)}`,
    answers ? { teamId, botSessionId } : undefined,
    { retry: false },
  )

  return data.bots
}

export async function getSlackConnectionStatus(teamId: string): Promise<SlackConnectionStatus> {
  return call<SlackConnectionStatus>('GET', `/teams/${teamId}/slack-installations/status`)
}

export async function getSlackInstallation(
  teamId: string,
): Promise<{ installation: SlackInstallation | null; oauthAvailable: boolean }> {
  return call<{ installation: SlackInstallation | null; oauthAvailable: boolean }>(
    'GET',
    `/teams/${teamId}/slack-installations`,
  )
}

export async function startSlackOAuth(teamId: string): Promise<SlackOAuthStart> {
  return call<SlackOAuthStart>(
    'POST',
    `/teams/${teamId}/slack-installations/start-oauth`,
    {},
    { retry: false },
  )
}

export async function cancelSlackOAuth(teamId: string, state: string): Promise<void> {
  await call<void>(
    'DELETE',
    `/teams/${teamId}/slack-installations/start-oauth/${encodeURIComponent(state)}`,
    undefined,
    { retry: false },
  )
}

export async function disconnectSlack(teamId: string): Promise<void> {
  await call<void>('DELETE', `/teams/${teamId}/slack-installations`, undefined, { retry: false })
}

export async function listSlackChannels(
  teamId: string,
): Promise<{ slackWorkspaceId: string | null; channels: SlackChannelOption[] }> {
  return call<{ slackWorkspaceId: string | null; channels: SlackChannelOption[] }>(
    'GET',
    `/teams/${teamId}/slack-installations/channels`,
  )
}

export async function getMySlackUserMapping(teamId: string): Promise<SlackUserMapping | null> {
  const data = await call<{ mapping: SlackUserMapping | null }>(
    'GET',
    `/slack/user-mappings/me?teamId=${encodeURIComponent(teamId)}`,
  )

  return data.mapping ?? null
}

export async function linkMySlackUser(
  teamId: string,
  input: { slackWorkspaceId: string; slackUserId: string },
): Promise<SlackUserMapping> {
  const data = await call<{ mapping: SlackUserMapping }>(
    'PUT',
    '/slack/user-mappings/self',
    { teamId, ...input },
    { retry: false },
  )

  return data.mapping
}

export async function upsertSlackChannelMapping(
  teamId: string,
  input: { slackWorkspaceId: string; slackChannelId: string; enabled?: boolean },
): Promise<SlackChannelMapping> {
  const data = await call<{ mapping: SlackChannelMapping }>(
    'PUT',
    '/slack/mappings',
    { teamId, ...input },
    { retry: false },
  )

  return data.mapping
}

export async function deleteSlackChannelMapping(
  teamId: string,
  slackWorkspaceId: string,
  slackChannelId: string,
): Promise<void> {
  await call<void>(
    'DELETE',
    `/slack/mappings/${slackWorkspaceId}/${slackChannelId}?teamId=${encodeURIComponent(teamId)}`,
    undefined,
    { retry: false },
  )
}

export async function listSlackUserMappings(teamId: string): Promise<SlackUserMapping[]> {
  const data = await call<{ mappings: SlackUserMapping[] }>(
    'GET',
    `/slack/user-mappings?teamId=${encodeURIComponent(teamId)}`,
  )

  return data.mappings ?? []
}

export async function upsertSlackUserMapping(
  teamId: string,
  input: {
    slackWorkspaceId: string
    slackUserId: string
    nuphosUserId: string
    enabled?: boolean
  },
): Promise<SlackUserMapping> {
  const data = await call<{ mapping: SlackUserMapping }>(
    'PUT',
    '/slack/user-mappings',
    { teamId, ...input },
    { retry: false },
  )

  return data.mapping
}

export async function deleteSlackUserMapping(
  teamId: string,
  slackWorkspaceId: string,
  slackUserId: string,
): Promise<void> {
  await call<void>(
    'DELETE',
    `/slack/user-mappings/${slackWorkspaceId}/${slackUserId}?teamId=${encodeURIComponent(teamId)}`,
    undefined,
    { retry: false },
  )
}
