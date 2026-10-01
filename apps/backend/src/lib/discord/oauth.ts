import { config } from '@/config'

const API = 'https://discord.com/api/v10'

export function isDiscordConfigured(): boolean {
  return Boolean(
    config.discord.botToken &&
    config.discord.clientId &&
    config.discord.clientSecret &&
    config.discord.oauthRedirect &&
    config.discord.publicKey,
  )
}

export function buildDiscordAuthorizeUrl(args: {
  state: string
  operation: 'install' | 'link'
  guildId?: string
}): string {
  if (!config.discord.clientId || !config.discord.oauthRedirect) {
    throw new Error('Discord OAuth is not configured')
  }
  const url = new URL('https://discord.com/oauth2/authorize')

  url.searchParams.set('client_id', config.discord.clientId)
  url.searchParams.set('redirect_uri', config.discord.oauthRedirect)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', args.state)
  url.searchParams.set(
    'scope',
    args.operation === 'install' ? 'identify bot applications.commands' : 'identify',
  )
  if (args.operation === 'install') {
    // View Channel + Send Messages + Read Message History + Create Public
    // Threads + Send Messages in Threads. Intentionally excludes Administrator.
    url.searchParams.set('permissions', '309237713920')
    url.searchParams.set('integration_type', '0')
    url.searchParams.set('prompt', 'consent')
    if (args.guildId) {
      url.searchParams.set('guild_id', args.guildId)
      url.searchParams.set('disable_guild_select', 'true')
    }
  }

  return url.toString()
}

export type DiscordOAuthResult = {
  accessToken: string
  user: { id: string; username: string; global_name?: string | null }
  guild?: { id: string; name: string }
}

export async function exchangeDiscordCode(code: string): Promise<DiscordOAuthResult> {
  const { clientId, clientSecret, oauthRedirect } = config.discord

  if (!clientId || !clientSecret || !oauthRedirect)
    throw new Error('Discord OAuth is not configured')
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: oauthRedirect,
  })
  const tokenResponse = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!tokenResponse.ok) throw new Error(`Discord OAuth exchange failed (${tokenResponse.status})`)
  const token = (await tokenResponse.json()) as {
    access_token: string
    guild?: { id: string; name: string }
  }
  const userResponse = await fetch(`${API}/users/@me`, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  })

  if (!userResponse.ok) throw new Error(`Discord user lookup failed (${userResponse.status})`)

  return {
    accessToken: token.access_token,
    user: (await userResponse.json()) as DiscordOAuthResult['user'],
    guild: token.guild,
  }
}
