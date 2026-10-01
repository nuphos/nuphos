import { call } from './client'

export type DiscordOAuthStart = { authorizeUrl: string; state: string }
export type DiscordConnection = {
  configured: boolean
  installation: { guildId: string; guildName: string } | null
  channels: { channelId: string }[]
  linkedDiscordUserId: string | null
}

export const getDiscordConnection = (teamId: string) =>
  call<DiscordConnection>('GET', `/teams/${teamId}/discord-installations`)

export const startDiscordOAuth = (teamId: string, operation: 'install' | 'link') =>
  call<DiscordOAuthStart>(
    'POST',
    `/teams/${teamId}/discord-installations/${operation === 'install' ? 'start-oauth' : 'start-link'}`,
    {},
    { retry: false },
  )

export async function cancelDiscordOAuth(teamId: string, state: string): Promise<void> {
  await call(
    'DELETE',
    `/teams/${teamId}/discord-installations/oauth/${encodeURIComponent(state)}`,
    undefined,
    { retry: false },
  )
}

export async function disconnectDiscord(teamId: string): Promise<void> {
  await call<void>('DELETE', `/teams/${teamId}/discord-installations`, undefined, { retry: false })
}
