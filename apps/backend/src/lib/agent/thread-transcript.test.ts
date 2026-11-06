import { describe, expect, test } from 'bun:test'

import {
  clipTranscriptText,
  TRANSCRIPT_BOT_MESSAGE_CHARS,
  TRANSCRIPT_MESSAGE_CHARS,
} from './thread-transcript'

describe('clipTranscriptText', () => {
  test('keeps head AND tail of an over-long message', () => {
    const clipped = clipTranscriptText(`START ${'x'.repeat(2_000)} END`)

    expect(clipped.startsWith('START')).toBe(true)
    expect(clipped.endsWith('END')).toBe(true)
    expect(clipped).toContain(' … ')
    expect(clipped).toHaveLength(TRANSCRIPT_MESSAGE_CHARS)
  })

  test('bot messages get a larger budget — the over-long ones are almost always the agent', () => {
    const text = 'y'.repeat(2_000)

    expect(clipTranscriptText(text, { fromBot: true })).toHaveLength(TRANSCRIPT_BOT_MESSAGE_CHARS)
    expect(TRANSCRIPT_BOT_MESSAGE_CHARS).toBeGreaterThan(TRANSCRIPT_MESSAGE_CHARS)
  })

  test('idempotent — storage-layer clipping then prompt-layer clipping loses nothing more', () => {
    const once = clipTranscriptText('z'.repeat(2_000), { fromBot: true })

    expect(clipTranscriptText(once, { fromBot: true })).toBe(once)
  })

  test('short messages pass through squashed but uncut', () => {
    expect(clipTranscriptText('  a\n b ')).toBe('a b')
  })
})
