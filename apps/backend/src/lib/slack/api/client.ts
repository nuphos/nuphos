import { createHmac, timingSafeEqual } from 'node:crypto'

import { config } from '@/config'
import { AppError } from '@/lib/errors'

export type SlackApiResponse = {
  ok: boolean
  error?: string
  channel?:
    | string
    | {
        id?: string
        name?: string
        is_ext_shared?: boolean
        is_member?: boolean
        is_private?: boolean
        is_archived?: boolean
      }
  user?:
    | {
        id?: string
        name?: string
        real_name?: string
        profile?: { email?: string; display_name?: string; real_name?: string }
      }
    | string
  ts?: string
  team_id?: string
  team?: string
  user_id?: string
  channels?: {
    id?: string
    name?: string
    is_private?: boolean
    is_archived?: boolean
    is_member?: boolean
  }[]
  // conversations.members result.
  members?: string[]
  response_metadata?: { next_cursor?: string }
  // assistant.search.context result buckets (fields per content type vary).
  results?: { messages?: Record<string, unknown>[] }
  // conversations.replies / conversations.history message list.
  messages?: Record<string, unknown>[]
  has_more?: boolean
  // files.getUploadURLExternal result.
  upload_url?: string
  file_id?: string
  // files.completeUploadExternal result.
  files?: { id?: string; title?: string }[]
  // chat.getPermalink result.
  permalink?: string
}

export function canVerifySlackRequests(): boolean {
  return !!config.slack.signingSecret
}

export function verifySlackSignature(
  rawBody: string,
  timestamp: string | undefined,
  signature: string | undefined,
): boolean {
  const signingSecret = config.slack.signingSecret

  if (!signingSecret || !timestamp || !signature) return false
  const timestampSec = Number(timestamp)

  if (!Number.isFinite(timestampSec)) return false
  if (Math.abs(Date.now() / 1000 - timestampSec) > 60 * 5) return false

  const expected = `v0=${createHmac('sha256', signingSecret)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest('hex')}`
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)

  if (a.length !== b.length) return false

  return timingSafeEqual(a, b)
}

export async function slackApi(
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<SlackApiResponse> {
  let response: Response

  try {
    response = await fetch(`https://slack.com/api/${method}`, {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    throw new AppError(
      502,
      'slack_api_error',
      err instanceof Error
        ? `Slack ${method} request failed: ${err.message}`
        : `Slack ${method} request failed`,
    )
  }

  let json: SlackApiResponse

  try {
    json = (await response.json()) as SlackApiResponse
  } catch {
    throw new AppError(502, 'slack_api_error', `Slack ${method} returned an unparseable response`)
  }

  if (!response.ok || !json.ok) {
    throw new AppError(502, 'slack_api_error', json.error ?? `Slack ${method} failed`)
  }

  return json
}

// GET variant for the read methods (conversations.replies etc.) that only
// accept URL-encoded arguments — POSTing JSON to them fails.
export async function slackApiGet(
  token: string,
  method: string,
  params: Record<string, string | number | undefined>,
): Promise<SlackApiResponse> {
  const query = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value))
  }
  let response: Response

  try {
    response = await fetch(`https://slack.com/api/${method}?${query.toString()}`, {
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${token}` },
    })
  } catch (err) {
    throw new AppError(
      502,
      'slack_api_error',
      err instanceof Error
        ? `Slack ${method} request failed: ${err.message}`
        : `Slack ${method} request failed`,
    )
  }

  let json: SlackApiResponse

  try {
    json = (await response.json()) as SlackApiResponse
  } catch {
    throw new AppError(502, 'slack_api_error', `Slack ${method} returned an unparseable response`)
  }

  if (!response.ok || !json.ok) {
    throw new AppError(502, 'slack_api_error', json.error ?? `Slack ${method} failed`)
  }

  return json
}
