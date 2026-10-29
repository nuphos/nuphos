import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'

import { config } from '@/config'
import { teamVcpuLimit } from '@/lib/agent/devices/box-instabox-limit'
import { AppError } from '@/lib/errors'

import type { TeamAuthVariables } from '@/middleware/auth'

/** OpenAI's own upload limit for a transcription. */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024

/**
 * Voice input from the mobile apps: the recording is transcribed by OpenAI
 * Whisper with the deployment's key. It is part of a subscription, so a team
 * without one is refused; a deployment with no billing service has no plans
 * and lets every team use it.
 */
export const voiceTranscriptionsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

voiceTranscriptionsRoutes.post(
  '/',
  bodyLimit({
    maxSize: MAX_AUDIO_BYTES + 64 * 1024,
    onError: () => {
      throw new AppError(413, 'recording_too_large', 'The recording is too long to transcribe.')
    },
  }),
  async (c) => {
    const apiKey = config.voice.openaiApiKey

    if (!apiKey) {
      throw new AppError(503, 'voice_unavailable', 'Voice input is not available on this server.')
    }
    if (config.box.billingUrl && !(await teamVcpuLimit(c.get('teamId'))).own) {
      throw new AppError(
        402,
        'subscription_required',
        'Voice input is included with a Nuphos subscription.',
      )
    }

    const body = await c.req.parseBody()

    if (!(body.file instanceof File)) throw new AppError(400, 'invalid_input', 'file is required')

    const form = new FormData()

    form.append('model', 'whisper-1')
    // verbose_json reports the language, which the apps use to pick a Chinese script.
    form.append('response_format', 'verbose_json')
    if (typeof body.prompt === 'string' && body.prompt.trim()) form.append('prompt', body.prompt)
    form.append('file', body.file)

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    }).catch(() => null)
    const reply = (await res?.json().catch(() => null)) as {
      text?: unknown
      language?: unknown
    } | null

    if (!res?.ok || typeof reply?.text !== 'string') {
      throw new AppError(503, 'transcription_failed', "The recording couldn't be transcribed.")
    }

    return c.json({
      text: reply.text,
      language: typeof reply.language === 'string' ? reply.language : null,
    })
  },
)
