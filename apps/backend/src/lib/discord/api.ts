import { config } from '@/config'

const API = 'https://discord.com/api/v10'

type DiscordApiErrorBody = { message?: string; code?: number; retry_after?: number }

export class DiscordApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | undefined,
    message: string,
  ) {
    super(`Discord API ${status}: ${message}`)
    this.name = 'DiscordApiError'
  }
}

export async function discordApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = config.discord.botToken

  if (!token) throw new Error('DISCORD_BOT_TOKEN is not configured')
  for (let attempt = 0; attempt < 3; attempt++) {
    const headers = new Headers(init.headers)

    headers.set('Authorization', `Bot ${token}`)
    headers.set('Content-Type', 'application/json')
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers,
    })

    if (response.ok) return (response.status === 204 ? undefined : await response.json()) as T
    const body = (await response.json().catch(() => ({}))) as DiscordApiErrorBody

    if (response.status === 429 && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, Math.ceil((body.retry_after ?? 1) * 1000)))
      continue
    }
    throw new DiscordApiError(response.status, body.code, body.message ?? response.statusText)
  }
  throw new Error('Discord API retry budget exhausted')
}

export type DiscordChannel = { id: string; type: number; guild_id?: string; parent_id?: string }
export type DiscordGuild = { id: string; name: string }

export const NUPHOS_DISCORD_COMMAND = {
  name: 'nuphos',
  description: 'Manage Nuphos in this Discord channel',
  // Channel administration is enforced in the handler; members may change their own mode.
  default_member_permissions: null,
  dm_permission: false,
  options: [
    { type: 1, name: 'full-access', description: 'Use Full Access for your turns in this thread' },
    { type: 1, name: 'auto', description: 'Use Auto Mode for your turns in this thread' },
    {
      type: 1,
      name: 'enable',
      description: 'Allow linked workspace members to mention Nuphos in this channel',
    },
    {
      type: 1,
      name: 'disable',
      description: 'Stop Nuphos from accepting mentions in this channel',
    },
  ],
} as const

export const getDiscordChannel = (channelId: string) =>
  discordApi<DiscordChannel>(`/channels/${encodeURIComponent(channelId)}`)
export const getDiscordGuild = (guildId: string) =>
  discordApi<DiscordGuild>(`/guilds/${encodeURIComponent(guildId)}`)

export async function registerDiscordCommands(): Promise<void> {
  const clientId = config.discord.clientId

  if (!clientId) throw new Error('DISCORD_CLIENT_ID is not configured')
  await discordApi(`/applications/${encodeURIComponent(clientId)}/commands`, {
    method: 'POST',
    body: JSON.stringify(NUPHOS_DISCORD_COMMAND),
  })
}

export async function createDiscordThread(args: {
  channelId: string
  messageId: string
  name: string
}): Promise<DiscordChannel> {
  return await discordApi(`/channels/${args.channelId}/messages/${args.messageId}/threads`, {
    method: 'POST',
    body: JSON.stringify({ name: args.name.slice(0, 100), auto_archive_duration: 1440 }),
  })
}

export async function sendDiscordMessage(channelId: string, content: string): Promise<void> {
  const chunks = splitDiscordText(content)

  for (const chunk of chunks) {
    await discordApi(`/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content: chunk, allowed_mentions: { parse: [] } }),
    })
  }
}

export async function sendDiscordApproval(args: {
  channelId: string
  content: string
  decisionId: string
}): Promise<void> {
  await discordApi(`/channels/${args.channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      content: args.content.slice(0, 2000),
      allowed_mentions: { parse: [] },
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 3,
              label: 'Allow once',
              custom_id: `nuphos:tool:approve:${args.decisionId}`,
            },
            {
              type: 2,
              style: 4,
              label: 'Reject',
              custom_id: `nuphos:tool:reject:${args.decisionId}`,
            },
          ],
        },
      ],
    }),
  })
}

export function splitDiscordText(text: string): string[] {
  const input = text.trim()

  if (!input) return []
  const chunks: string[] = []
  let rest = input
  let activeFence: string | null = null

  while (rest) {
    const prefix = activeFence ? `${activeFence}\n` : ''
    let cut = Math.min(rest.length, 2000 - prefix.length)
    let nextFence = discordFenceState(rest.slice(0, cut), activeFence)

    if (nextFence && prefix.length + cut + 4 > 2000) {
      cut -= 4
    }
    if (cut < rest.length) {
      const window = rest.slice(0, cut)
      const newline = window.lastIndexOf('\n')
      const space = window.lastIndexOf(' ')
      const boundary = newline > 0 ? newline : space

      if (boundary > 0) cut = boundary + 1
    }
    let raw = rest.slice(0, cut)

    nextFence = discordFenceState(raw, activeFence)
    let suffix = nextFence ? '\n```' : ''

    while (prefix.length + raw.length + suffix.length > 2000) {
      cut -= prefix.length + raw.length + suffix.length - 2000
      raw = rest.slice(0, cut)
      nextFence = discordFenceState(raw, activeFence)
      suffix = nextFence ? '\n```' : ''
    }

    chunks.push(`${prefix}${raw}${suffix}`)
    rest = rest.slice(cut)
    activeFence = nextFence
  }

  return chunks
}

function discordFenceState(text: string, initial: string | null): string | null {
  let active = initial

  for (const line of text.split('\n')) {
    const marker = line.trim()

    if (!marker.startsWith('```')) continue
    active = active ? null : marker
  }

  return active
}

// Interaction tokens authorize only their own response. Never log them or send
// the bot token to these webhook endpoints.
async function interactionRequest(path: string, method: string, body: unknown): Promise<void> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok)
    throw new Error(`Discord interaction response failed (${String(response.status)})`)
}

export const acknowledgeDiscordInteraction = (id: string, token: string) =>
  interactionRequest(
    `/interactions/${encodeURIComponent(id)}/${encodeURIComponent(token)}/callback`,
    'POST',
    {
      type: 5,
      data: { flags: 64 },
    },
  )

export const editDiscordInteractionResponse = (
  applicationId: string,
  token: string,
  data: unknown,
) =>
  interactionRequest(
    `/webhooks/${encodeURIComponent(applicationId)}/${encodeURIComponent(token)}/messages/@original`,
    'PATCH',
    data,
  )
