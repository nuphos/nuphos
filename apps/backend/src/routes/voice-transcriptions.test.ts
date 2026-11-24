import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { config } from '@/config'
import { errorHandler } from '@/lib/errors'
import { useBoxInstaboxLimit } from '@/lib/test/doubles/box-instabox-limit'

import type { TeamAuthVariables } from '@/middleware/auth'

let subscribed = true

useBoxInstaboxLimit({
  teamVcpuLimit: async () => ({ limit: subscribed ? 4 : 0, own: subscribed }),
})

const { voiceTranscriptionsRoutes } = await import('@/routes/voice-transcriptions')

const app = new Hono<{ Variables: TeamAuthVariables }>()

app.use('*', async (c, next) => {
  c.set('teamId', '64b5f1c2e4b0a1d2c3e4f501')
  await next()
})
app.route('/', voiceTranscriptionsRoutes)
app.onError(errorHandler)

const realFetch = globalThis.fetch
const realVoice = config.voice
const realBillingUrl = config.box.billingUrl
let sent: FormData | null = null
let sentTo = ''

beforeEach(() => {
  subscribed = true
  sent = null
  sentTo = ''
  config.voice = { openaiApiKey: 'sk-test', openaiBaseUrl: 'https://api.openai.com/v1' }
  config.box.billingUrl = 'https://billing.example.com'
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sentTo = url
    sent = init.body as FormData

    return Response.json({ text: '你好', language: 'chinese' })
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  config.voice = realVoice
  config.box.billingUrl = realBillingUrl
})

function transcribe(fields: Record<string, string | Blob> = {}) {
  const form = new FormData()

  for (const [name, value] of Object.entries(fields)) form.append(name, value)

  return app.request('/', { method: 'POST', body: form })
}

const audio = new File([new Uint8Array([1, 2, 3])], 'dictation.m4a', { type: 'audio/m4a' })

describe('POST /teams/:teamId/voice-transcriptions', () => {
  test('transcribes a subscribed team’s recording with the server key', async () => {
    const res = await transcribe({ file: audio, prompt: 'Nuphos' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ text: '你好', language: 'chinese' })
    expect(sent?.get('model')).toBe('whisper-1')
    expect(sent?.get('prompt')).toBe('Nuphos')
    expect(sent?.get('file')).toBeInstanceOf(File)
    expect(sentTo).toBe('https://api.openai.com/v1/audio/transcriptions')
  })

  test('sends the recording to OPENAI_BASE_URL when it is set', async () => {
    config.voice = { openaiApiKey: 'sk-test', openaiBaseUrl: 'http://127.0.0.1:4010/v1' }

    expect((await transcribe({ file: audio })).status).toBe(200)
    expect(sentTo).toBe('http://127.0.0.1:4010/v1/audio/transcriptions')
  })

  test('refuses a team without a subscription', async () => {
    subscribed = false
    const res = await transcribe({ file: audio })

    expect(res.status).toBe(402)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'subscription_required',
    )
    expect(sent).toBeNull()
  })

  test('lets every team in when the deployment has no billing service', async () => {
    subscribed = false
    config.box.billingUrl = undefined

    expect((await transcribe({ file: audio })).status).toBe(200)
  })

  test('is unavailable without a server key', async () => {
    config.voice = { openaiBaseUrl: 'https://api.openai.com/v1' }

    expect((await transcribe({ file: audio })).status).toBe(503)
  })

  test('needs a file', async () => {
    expect((await transcribe({ prompt: 'x' })).status).toBe(400)
  })

  test('reports an OpenAI failure', async () => {
    globalThis.fetch = (async () =>
      Response.json({ error: { message: 'nope' } }, { status: 500 })) as unknown as typeof fetch

    expect((await transcribe({ file: audio })).status).toBe(503)
  })
})
