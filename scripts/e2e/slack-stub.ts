// Slack as the backend sees it: a Web API that knows only the users a scenario adds, and the
// secrets that sign its events. Nothing here reaches Slack.
import { createCipheriv, createHmac, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'

import type { Stack } from './stack.ts'

// Made per run, as only this process signs events for the backend it starts.
const SIGNING_SECRET = randomBytes(32).toString('hex')
/** Hex, so the backend reads it as the 32-byte key it seals Slack tokens with. */
const SLACK_TOKEN_KEY = '6c6f63616c2d6532652d736c61636b2d6b65792d6e6f742d666f722d70726f64'

type SlackUser = { team_id: string; email: string; name: string }

const slackUsers = new Map<string, SlackUser>()

/** Who users.info reports for this Slack user id: their home workspace, email and name. */
export function addSlackUser(id: string, user: SlackUser) {
  slackUsers.set(id, user)
}
const posts: Record<string, string>[] = []

/** What the backend posted with chat.postMessage, oldest first. */
export const slackPosts = () => [...posts]

function postMessage(params: Record<string, string>) {
  posts.push(params)

  return {
    ok: true,
    channel: params.channel,
    ts: `1900000000.${String(posts.length).padStart(6, '0')}`,
  }
}

function usersInfo(id: string) {
  const user = slackUsers.get(id)

  if (!user) return { ok: false, error: 'user_not_found' }
  const profile = { email: user.email, real_name: user.name }

  return { ok: true, user: { id, team_id: user.team_id, real_name: user.name, profile } }
}

const METHODS: Record<string, (params: Record<string, string>) => object> = {
  'users.info': (params) => usersInfo(params.user ?? ''),
  'chat.postMessage': postMessage,
}

/** Starts it on a free port; the backend's environment to reach it. */
export async function startSlackStub(): Promise<Record<string, string>> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://slack')
    const method = url.pathname.split('/').at(-1) ?? ''
    const chunks: Buffer[] = []

    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const body = chunks.length > 0 ? (JSON.parse(Buffer.concat(chunks).toString()) as object) : {}
      const params = { ...Object.fromEntries(url.searchParams), ...body } as Record<string, string>

      const answer =
        CHANNEL_METHODS[method]?.(params) ?? (METHODS[method] ?? (() => ({ ok: true })))(params)

      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(answer))
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0

  server.unref()

  return {
    SLACK_API_BASE_URL: `http://127.0.0.1:${String(port)}/api`,
    SLACK_SIGNING_SECRET: SIGNING_SECRET,
    SLACK_TOKEN_ENCRYPTION_KEY: SLACK_TOKEN_KEY,
  }
}

type SlackMessage = { ts: string; text: string; user?: string; thread_ts?: string }
type SlackChannel = { name: string; private?: boolean; joined: boolean; messages: SlackMessage[] }

const slackChannels = new Map<string, SlackChannel>()

/** A channel conversations.* knows, with its messages oldest first; a thread reply has thread_ts. */
export function addSlackChannel(id: string, channel: SlackChannel) {
  slackChannels.set(id, channel)
}

// Answer only for a channel a scenario added; any other falls through to METHODS.
const CHANNEL_METHODS: Record<string, (params: Record<string, string>) => object | undefined> = {
  'conversations.info': (params) => {
    const channel = slackChannels.get(params.channel ?? '')

    return (
      channel && {
        ok: true,
        channel: {
          id: params.channel,
          name: channel.name,
          is_private: channel.private === true,
          is_member: channel.joined,
        },
      }
    )
  },
  'conversations.history': (params) => {
    const channel = slackChannels.get(params.channel ?? '')
    const roots = channel?.messages.filter(
      (message) => (message.thread_ts ?? message.ts) === message.ts,
    )

    return channel && { ok: true, messages: roots?.toReversed(), has_more: false }
  },
  'conversations.replies': (params) => {
    const channel = slackChannels.get(params.channel ?? '')
    const thread = channel?.messages.filter(
      (message) => (message.thread_ts ?? message.ts) === params.ts,
    )

    return channel && { ok: true, messages: thread, has_more: false }
  },
}

/** A bot token sealed the way the backend stores it, under the stub's key. */
export function sealSlackToken(token: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(SLACK_TOKEN_KEY, 'hex'), iv)
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])

  return {
    v: 1,
    alg: 'A256GCM',
    keyId: 'default',
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }
}

/** Delivers one Events API callback to the backend, signed as Slack signs it. */
export async function sendSlackEvent(stack: Stack, envelope: object): Promise<void> {
  const body = JSON.stringify(envelope)
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signed = ['v0', timestamp, body].join(':')
  const signature = `v0=${createHmac('sha256', SIGNING_SECRET).update(signed).digest('hex')}`
  const response = await fetch(`${stack.apiUrl}/slack/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Slack-Request-Timestamp': timestamp,
      'X-Slack-Signature': signature,
    },
    body,
  })

  if (!response.ok) throw new Error(`Slack event answered ${String(response.status)}`)
}
