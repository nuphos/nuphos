// Discord as the backend sees it: a REST API and a Gateway on one local port, and the key that
// signs its interactions. Nothing here reaches Discord.
import { generateKeyPairSync, sign } from 'node:crypto'

import type { Stack } from './stack.ts'
import type { ServerWebSocket } from 'bun'

export const DISCORD_GUILD = 'GE2E'
export const DISCORD_CHANNEL = 'CE2E'
export const DISCORD_BOT = 'DE2EBOT'

// Made per run, as only this process signs interactions for the backend it starts.
const { publicKey, privateKey } = generateKeyPairSync('ed25519')

type DiscordChannel = { id: string; type: number; guild_id: string; parent_id?: string }

const channels = new Map<string, DiscordChannel>([
  [DISCORD_CHANNEL, { id: DISCORD_CHANNEL, type: 0, guild_id: DISCORD_GUILD }],
])
const posts: { channelId: string; content: string }[] = []
const interactionReplies: { content?: string }[] = []
let gateway: ServerWebSocket | undefined
let sequence = 0

/** What the backend posted to a channel or thread, oldest first. */
export const discordPosts = () => [...posts]

/** What the backend answered interactions with, oldest first. */
export const discordInteractionReplies = () => [...interactionReplies]

const json = (body: unknown) => Response.json(body)

async function rest(request: Request, path: string, origin: string): Promise<Response> {
  const parts = path.split('/').filter(Boolean)

  if (path === '/gateway/bot') return json({ url: `${origin.replace('http', 'ws')}/gateway` })
  if (parts[0] === 'interactions') return new Response(null, { status: 204 })
  if (parts[0] === 'webhooks') {
    interactionReplies.push((await request.json()) as { content?: string })

    return json({ id: 'original' })
  }
  if (parts[0] !== 'channels' || !parts[1]) return json({})
  const channel = channels.get(parts[1])

  if (!channel) return Response.json({ message: 'Unknown Channel', code: 10003 }, { status: 404 })
  if (parts.length === 2) return json(channel)
  if (parts[2] === 'typing') return new Response(null, { status: 204 })
  // A thread started on a message: its id is the message's, as in Discord.
  if (parts[4] === 'threads') {
    const thread = {
      id: `T${parts[3]}`,
      type: 11,
      guild_id: channel.guild_id,
      parent_id: channel.id,
    }

    channels.set(thread.id, thread)

    return json(thread)
  }
  if (parts[2] === 'messages' && request.method === 'POST') {
    const { content } = (await request.json()) as { content: string }

    posts.push({ channelId: channel.id, content })

    return json({ id: `M${String(posts.length)}`, channel_id: channel.id, content })
  }

  return json([])
}

function dispatch(t: string, d: unknown) {
  if (!gateway) throw new Error('The backend has no Discord Gateway connection')
  gateway.send(JSON.stringify({ op: 0, s: ++sequence, t, d }))
}

/** Starts it on a free port; the backend's environment to reach it. */
export async function startDiscordStub(): Promise<Record<string, string>> {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request, server) {
      const url = new URL(request.url)

      if (url.pathname === '/gateway') {
        return server.upgrade(request) ? undefined : new Response(null, { status: 400 })
      }

      return await rest(request, url.pathname.replace(/^\/api\/v10/, ''), url.origin)
    },
    websocket: {
      open(socket) {
        gateway = socket
        socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 30_000 } }))
      },
      message(socket, raw) {
        const { op } = JSON.parse(String(raw)) as { op: number }

        if (op === 1) socket.send(JSON.stringify({ op: 11 }))
        // Identify or resume: either way the backend learns who the bot is.
        if (op === 2 || op === 6) {
          dispatch('READY', {
            session_id: 'e2e',
            resume_gateway_url: `ws://127.0.0.1:${String(server.port)}/gateway`,
            user: { id: DISCORD_BOT },
          })
        }
      },
      close(socket) {
        if (gateway === socket) gateway = undefined
      },
    },
  })

  server.unref()

  return {
    DISCORD_API_BASE_URL: `http://127.0.0.1:${String(server.port)}/api/v10`,
    DISCORD_BOT_TOKEN: 'e2e-discord-bot-token',
    DISCORD_PUBLIC_KEY: publicKey
      .export({ format: 'der', type: 'spki' })
      .subarray(-32)
      .toString('hex'),
  }
}

/** Waits for the backend's Gateway connection, which starts with the backend. */
export const discordGatewayReady = () => gateway !== undefined

/** One person's message in a channel, delivered over the Gateway as Discord delivers it. */
export function deliverDiscordMessage(message: {
  id: string
  channelId: string
  authorId: string
  content: string
  mentionsBot: boolean
}) {
  dispatch('MESSAGE_CREATE', {
    id: message.id,
    guild_id: DISCORD_GUILD,
    channel_id: message.channelId,
    content: message.content,
    author: { id: message.authorId, username: message.authorId },
    mentions: message.mentionsBot ? [{ id: DISCORD_BOT }] : [],
  })
}

let interactions = 0

/** Posts one interaction to the backend's endpoint, signed as Discord signs it. */
export async function sendDiscordInteraction(stack: Stack, interaction: object): Promise<void> {
  const body = JSON.stringify({
    id: `IE2E${String(++interactions)}`,
    application_id: 'AE2E',
    token: `e2e-interaction-${String(interactions)}`,
    guild_id: DISCORD_GUILD,
    channel_id: DISCORD_CHANNEL,
    ...interaction,
  })
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString('hex')
  const response = await fetch(`${stack.apiUrl}/discord/interactions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Signature-Ed25519': signature,
      'X-Signature-Timestamp': timestamp,
    },
    body,
  })

  if (!response.ok) throw new Error(`Discord interaction answered ${String(response.status)}`)
}
