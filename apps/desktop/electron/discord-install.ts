import { shell } from 'electron'

import * as atlas from './atlas'

export const DISCORD_CALLBACK_HOST = 'discord-callback'
const TIMEOUT_MS = 10 * 60 * 1000

type Result = { teamId: string; guildId: string; guildName: string; discordUserId: string }
type Pending = {
  teamId: string
  resolve: (result: Result) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

const pending = new Map<string, Pending>()

export async function startOAuth(teamId: string, operation: 'install' | 'link'): Promise<Result> {
  const { authorizeUrl, state } = await atlas.startDiscordOAuth(teamId, operation)

  return await new Promise<Result>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!pending.delete(state)) return
      void atlas.cancelDiscordOAuth(teamId, state).catch(() => {})
      reject(new Error('Discord authorization timed out — please try again.'))
    }, TIMEOUT_MS)

    pending.set(state, { teamId, resolve, reject, timeout })
    void shell.openExternal(authorizeUrl).catch((err: unknown) => {
      if (!pending.delete(state)) return
      clearTimeout(timeout)
      reject(err instanceof Error ? err : new Error(String(err)))
    })
  })
}

export function isCallbackUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)

    return url.hostname === DISCORD_CALLBACK_HOST || url.host === DISCORD_CALLBACK_HOST
  } catch {
    return false
  }
}

export async function handleCallback(rawUrl: string): Promise<void> {
  const url = new URL(rawUrl)
  const state = url.searchParams.get('state')
  const request = state ? pending.get(state) : null

  if (!state || !request) return
  pending.delete(state)
  clearTimeout(request.timeout)
  const error = url.searchParams.get('error')

  if (error) {
    request.reject(
      new Error(
        `Discord authorization failed: ${url.searchParams.get('error_description') ?? error}`,
      ),
    )

    return
  }
  request.resolve({
    teamId: url.searchParams.get('team_id') ?? request.teamId,
    guildId: url.searchParams.get('guild_id') ?? '',
    guildName: url.searchParams.get('guild_name') ?? '',
    discordUserId: url.searchParams.get('discord_user_id') ?? '',
  })
}

export function cancelAllPending(): void {
  for (const [state, request] of pending) {
    clearTimeout(request.timeout)
    void atlas.cancelDiscordOAuth(request.teamId, state).catch(() => {})
    request.reject(new Error('Discord authorization cancelled'))
  }
  pending.clear()
}
