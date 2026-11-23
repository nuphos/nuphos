// Discord as the backend sees it: a REST API and a Gateway on one local port, and the key that
// signs its interactions. Nothing here reaches Discord.
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { createServer } from 'node:http'

import type { Stack } from './stack.ts'
import type { Duplex } from 'node:stream'

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
let gateway: Duplex | undefined
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

/** One unmasked text frame, as a server sends it. */
function frame(text: string): Buffer {
  const payload = Buffer.from(text)
  const header =
    payload.length < 126
      ? Buffer.from([0x81, payload.length])
      : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff])

  return Buffer.concat([header, payload])
}

const send = (socket: Duplex, message: object) => socket.write(frame(JSON.stringify(message)))

function dispatch(t: string, d: unknown) {
  if (!gateway) throw new Error('The backend has no Discord Gateway connection')
  send(gateway, { op: 0, s: ++sequence, t, d })
}

/** The masked text frames a client sends; the backend's are well under 64 KiB. */
function* frames(buffer: Buffer): Generator<{ opcode: number; text: string; end: number }> {
  let at = 0

  while (buffer.length - at >= 6) {
    const opcode = buffer[at] & 0x0f
    let length = buffer[at + 1] & 0x7f
    let start = at + 2

    if (length === 126) {
      length = buffer.readUInt16BE(start)
      start += 2
    }
    if (buffer.length < start + 4 + length) return
    const mask = buffer.subarray(start, start + 4)
    const payload = buffer.subarray(start + 4, start + 4 + length).map((b, i) => b ^ mask[i % 4])

    at = start + 4 + length
    yield { opcode, text: payload.toString(), end: at }
  }
}

function serveGateway(socket: Duplex, key: string, port: number) {
  // eslint-disable-next-line sonarjs/hashing -- RFC 6455 fixes SHA-1 for the handshake.
  const accept = createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64')

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  )
  gateway = socket
  send(socket, { op: 10, d: { heartbeat_interval: 30_000 } })
  let pending = Buffer.alloc(0)

  socket.on('data', (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk])
    for (const { opcode, text, end } of frames(pending)) {
      pending = pending.subarray(end)
      if (opcode === 8) socket.end()
      if (opcode !== 1) continue
      const { op } = JSON.parse(text) as { op: number }

      if (op === 1) send(socket, { op: 11 })
      // Identify or resume: either way the backend learns who the bot is.
      if (op === 2 || op === 6) {
        dispatch('READY', {
          session_id: 'e2e',
          resume_gateway_url: `ws://127.0.0.1:${String(port)}/gateway`,
          user: { id: DISCORD_BOT },
        })
      }
    }
  })
  socket.on('close', () => {
    if (gateway === socket) gateway = undefined
  })
}

/** Starts it on a free port; the backend's environment to reach it. */
export async function startDiscordStub(): Promise<Record<string, string>> {
  const server = createServer((request, response) => {
    const origin = `http://${request.headers.host ?? ''}`
    const chunks: Buffer[] = []

    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined
      const path = (request.url ?? '/').split('?')[0].replace(/^\/api\/v10/, '')
      const fetchRequest = new Request(origin + path, { method: request.method, body })

      void rest(fetchRequest, path, origin).then(async (answer) => {
        response.writeHead(answer.status, { 'content-type': 'application/json' })
        response.end(Buffer.from(await answer.arrayBuffer()))
      })
    })
  })

  server.on('upgrade', (request, socket) => {
    serveGateway(socket, String(request.headers['sec-websocket-key']), port)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0

  server.unref()

  return {
    DISCORD_API_BASE_URL: `http://127.0.0.1:${String(port)}/api/v10`,
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
