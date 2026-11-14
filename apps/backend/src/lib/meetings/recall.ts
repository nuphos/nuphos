import { createHmac, timingSafeEqual } from 'node:crypto'

import { config } from '@/config'
import { AppError } from '@/lib/errors'
import { logError } from '@/lib/observability'

import type { MeetingsConfig } from '@/config/meetings'

type Recall = NonNullable<MeetingsConfig['recall']>

const MAX_SKEW_SECONDS = 5 * 60

export function recallConfig(): Recall {
  const recall = config.meetings.recall

  if (!recall)
    throw new AppError(503, 'meetings_not_configured', 'Meetings are not set up on this server')

  return recall
}

async function recallFetch(path: string, body: object): Promise<unknown> {
  const recall = recallConfig()
  const response = await fetch(`https://${recall.region}.recall.ai/api/v1${path}`, {
    method: 'POST',
    headers: { Authorization: recall.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok)
    throw new AppError(502, 'recall_error', `Recall.ai ${path} failed: ${await response.text()}`)

  return response.json()
}

/** Sends a bot into the meeting; its transcript and chat arrive at `webhookUrl`. */
export async function createMeetingBot(input: {
  meetingUrl: string
  botName: string
  webhookUrl: string
}): Promise<string> {
  const recall = recallConfig()
  const bot = (await recallFetch('/bot/', {
    meeting_url: input.meetingUrl,
    bot_name: input.botName,
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

/** A meeting channel's post also goes to the call's chat; the post stands if that fails. */
export function forwardToMeeting(
  channel: { sessionId: string; meeting?: { botId: string } },
  text: string,
): void {
  if (!channel.meeting) return
  void sendMeetingChat(channel.meeting.botId, text).catch((error: unknown) => {
    logError('meeting.chat_failed', error, { channel_id: channel.sessionId })
  })
}

export async function leaveMeeting(botId: string): Promise<void> {
  await recallFetch(`/bot/${botId}/leave_call/`, {}).catch((error: unknown) => {
    // Recall calls a bot whose call already ended "unstarted": it is out either way.
    if (!(error instanceof AppError && error.message.includes('cannot_command_unstarted_bot')))
      throw error
  })
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
