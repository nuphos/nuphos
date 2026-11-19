import { createHmac, timingSafeEqual } from 'node:crypto'

import { config } from '@/config'
import { AppError } from '@/lib/errors'
import { logEvent } from '@/lib/observability'

import type { MeetingsConfig } from '@/config/meetings'

type Recall = NonNullable<MeetingsConfig['recall']>

const MAX_SKEW_SECONDS = 5 * 60

export function recallConfig(): Recall {
  const recall = config.meetings.recall

  if (!recall)
    throw new AppError(503, 'meetings_not_configured', 'Meetings are not set up on this server')

  return recall
}

// Recall answers 401 for a bad API key and 402 when the account is out of credit: no bot joins
// any call until someone fixes the account.
const ACCOUNT_STATUSES = new Set([401, 402])

function recallCode(body: string): string | undefined {
  try {
    const { code } = JSON.parse(body) as { code?: unknown }

    return typeof code === 'string' ? code : undefined
  } catch {
    return undefined
  }
}

/**
 * One log line for every meeting bot that did not make it: Recall refused a request, gave up
 * on the bot, or the bot never joined. Any reason counts; Recall's codes are only there to read.
 */
export function logMeetingBotFailure(
  reason: 'request_failed' | 'fatal' | 'join_timeout',
  details: {
    path?: string
    status?: number
    code?: string | null
    sub_code?: string | null
    bot_id?: string
    session_id?: string
  },
): void {
  logEvent('warn', 'meeting_bot.failed', {
    reason,
    ...details,
    account_level: details.status !== undefined && ACCOUNT_STATUSES.has(details.status),
  })
}

/** A GET without `body`. `done` names the Recall error code that means it is already done. */
async function recallFetch(path: string, body?: object, done?: string): Promise<unknown> {
  const recall = recallConfig()
  const response = await fetch(`https://${recall.region}.recall.ai/api/v1${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: recall.apiKey, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    const code = recallCode(text)

    if (done && code === done) return
    logMeetingBotFailure('request_failed', { path, status: response.status, code })
    throw new AppError(502, 'recall_error', `Recall.ai ${path} failed: ${text}`)
  }

  return response.json()
}

/** Sends a bot into the meeting; its transcript and chat arrive at `webhookUrl`. */
export async function createMeetingBot(input: {
  meetingUrl: string
  botName: string
  /** Base64 JPEG the bot shows as its camera. */
  face: string
  webhookUrl: string
}): Promise<string> {
  const recall = recallConfig()
  const image = { kind: 'jpeg', b64_data: input.face }
  const bot = (await recallFetch('/bot/', {
    meeting_url: input.meetingUrl,
    bot_name: input.botName,
    automatic_video_output: { in_call_recording: image, in_call_not_recording: image },
    // Recall leaves an empty call in seconds by default; this also leaves one where only notetakers
    // are left. Bots are told by name only: people who just type in the chat never count as bots.
    automatic_leave: {
      bot_detection: {
        // Recall has no switch for its activity check and fills in a default when it is left out,
        // so it is set to start a day into the call, which no call reaches.
        using_participant_events: { timeout: 600, activate_after: 86_400 },
        using_participant_names: {
          matches: ['notetaker', 'recorder', 'assistant'],
          timeout: 60,
          activate_after: 60,
        },
      },
    },
    recording_config: {
      // Zero data retention: only the real-time stream is used, so Recall keeps no media.
      retention: null,
      transcript: {
        provider: recall.transcriptProvider ?? {
          recallai_streaming: { mode: 'prioritize_low_latency', language_code: 'en' },
        },
        diarization: { use_separate_streams_when_available: true },
      },
      realtime_endpoints: [
        {
          type: 'webhook',
          url: input.webhookUrl,
          events: ['transcript.data', 'participant_events.chat_message'],
        },
      ],
    },
  })) as { id: string }

  return bot.id
}

export async function sendMeetingChat(botId: string, message: string): Promise<void> {
  await recallFetch(`/bot/${botId}/send_chat_message/`, { message: message.slice(0, 4096) })
}

export async function leaveMeeting(botId: string): Promise<void> {
  // Recall calls a bot whose call already ended "unstarted": it is out either way.
  await recallFetch(`/bot/${botId}/leave_call/`, {}, 'cannot_command_unstarted_bot')
}

/** Whether the bot ever got into its call, and the last status Recall gave it. */
export async function meetingBotStatus(botId: string) {
  const bot = (await recallFetch(`/bot/${botId}/`)) as {
    status_changes?: { code: string; sub_code?: string | null }[]
  }
  const changes = bot.status_changes ?? []

  return {
    joined: changes.some(({ code }) => code.startsWith('in_call')),
    last: changes.at(-1),
  }
}

/** Recall signs `id.timestamp.body` with the workspace secret (Standard Webhooks). */
export function verifyRecallSignature(
  secret: string,
  headers: { id?: string; timestamp?: string; signature?: string },
  body: string,
  now = Date.now(),
): boolean {
  const { id, timestamp, signature } = headers

  if (!id || !timestamp || !signature || !secret.startsWith('whsec_')) return false
  const skew = Math.abs(now / 1000 - Number(timestamp))

  if (!Number.isFinite(skew) || skew > MAX_SKEW_SECONDS) return false
  const expected = createHmac('sha256', Buffer.from(secret.slice('whsec_'.length), 'base64'))
    .update(`${id}.${timestamp}.${body}`)
    .digest()

  return signature.split(' ').some((versioned) => {
    const [version, value] = versioned.split(',')
    const given = Buffer.from(value ?? '', 'base64')

    return version === 'v1' && given.length === expected.length && timingSafeEqual(given, expected)
  })
}
