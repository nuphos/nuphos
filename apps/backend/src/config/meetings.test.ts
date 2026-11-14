import { afterEach, describe, expect, test } from 'bun:test'

import { meetingsConfig } from './meetings'

const KEYS = ['RECALL_API_KEY', 'RECALL_WEBHOOK_SECRET', 'RECALL_TRANSCRIPT_PROVIDER'] as const
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]))

function setEnv(provider?: string) {
  process.env.RECALL_API_KEY = 'key'
  process.env.RECALL_WEBHOOK_SECRET = 'whsec_x'
  if (provider === undefined) delete process.env.RECALL_TRANSCRIPT_PROVIDER
  else process.env.RECALL_TRANSCRIPT_PROVIDER = provider
}

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

describe('RECALL_TRANSCRIPT_PROVIDER', () => {
  test('is passed to Recall as the JSON given', () => {
    setEnv('{"soniox_streaming":{"model":"stt-rt-v6","language_hints":["zh","en"]}}')

    expect(meetingsConfig().recall?.transcriptProvider).toEqual({
      soniox_streaming: { model: 'stt-rt-v6', language_hints: ['zh', 'en'] },
    })
  })

  test('unset leaves the built-in provider', () => {
    setEnv()

    expect(meetingsConfig().recall?.transcriptProvider).toBeUndefined()
  })

  test('a bare provider name is refused at startup', () => {
    setEnv('soniox_streaming')

    expect(() => meetingsConfig()).toThrow()
    setEnv('["soniox_streaming"]')

    expect(() => meetingsConfig()).toThrow('JSON object')
  })
})
