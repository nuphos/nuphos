import { describe, expect, test } from 'bun:test'

import { CONTENT_FILTER_FALLBACK_TEXT, withContentFilterFallback } from '@/routes/agent/transcript'

type TranscriptMessage = {
  id: string
  role: 'user' | 'assistant'
  parts: unknown[]
}

const stepStartOnly = (): TranscriptMessage[] => [
  { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
  { id: 'a1', role: 'assistant', parts: [{ type: 'step-start' }] },
]

describe('withContentFilterFallback', () => {
  test('appends a visible fallback when a content-filtered assistant turn has no text', () => {
    const messages = stepStartOnly()
    const result = withContentFilterFallback(messages as never, 'content-filter')
    const assistant = result.at(-1)!

    expect(assistant.parts).toEqual([
      { type: 'step-start' },
      { type: 'text', text: CONTENT_FILTER_FALLBACK_TEXT },
    ])
  })

  test('does not touch messages when the assistant already produced text', () => {
    const messages: TranscriptMessage[] = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'real answer' }] },
    ]
    const result = withContentFilterFallback(messages as never, 'content-filter')

    expect(result).toBe(messages)
    expect(result.at(-1)!.parts).toEqual([{ type: 'text', text: 'real answer' }])
  })

  test('ignores non-content-filter finish reasons', () => {
    const messages = stepStartOnly()

    expect(withContentFilterFallback(messages as never, 'stop')).toBe(messages)
    expect(withContentFilterFallback(messages as never, null)).toBe(messages)
    expect(withContentFilterFallback(messages as never, undefined)).toBe(messages)
  })

  test('treats whitespace-only text as empty and appends the fallback', () => {
    const messages: TranscriptMessage[] = [
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: '   ' }] },
    ]
    const result = withContentFilterFallback(messages as never, 'content-filter')

    expect(result.at(-1)!.parts).toContainEqual({
      type: 'text',
      text: CONTENT_FILTER_FALLBACK_TEXT,
    })
  })

  test('does not mutate the input array', () => {
    const messages = stepStartOnly()
    const before = structuredClone(messages)

    withContentFilterFallback(messages as never, 'content-filter')

    expect(messages).toEqual(before)
  })
})
