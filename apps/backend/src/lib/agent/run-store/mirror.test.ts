import { describe, expect, test } from 'bun:test'

import { replayFrame } from './mirror'

const frame = (payload: object) => `data: ${JSON.stringify(payload)}\n\n`
const parse = (replayed: string) =>
  JSON.parse(replayed.slice('data: '.length)) as Record<string, unknown>
const big = 'A'.repeat(200_000)

describe('replayFrame', () => {
  test('keeps a frame under the limit as it is', () => {
    const small = frame({ type: 'tool-input-available', toolCallId: 'w1', input: { path: 'a' } })

    expect(replayFrame(small)).toBe(small)
  })

  test.each([
    [
      'tool-input-available',
      { toolCallId: 'w1', toolName: 'Write', input: { path: 'a.txt', content: big } },
      'input',
    ],
    ['tool-output-available', { toolCallId: 'r1', output: big }, 'output'],
    ['file', { mediaType: 'image/png', url: `data:image/png;base64,${big}` }, 'url'],
    [
      'atlas-transcript-tail',
      { messagesFirstIndex: 12, messages: [{ role: 'assistant', parts: [{ text: big }] }] },
      'messages',
    ],
  ])(
    'an oversized %s frame keeps its small fields',
    (type: string, fields: Record<string, unknown>, large: string) => {
      const replayed = replayFrame(frame({ type, ...fields }))
      const payload = parse(replayed)

      expect(replayed.length).toBeLessThan(1_024)
      expect(payload.type).toBe(type)
      expect(payload[large]).toEqual({
        omitted: true,
        bytes: JSON.stringify(fields[large]).length,
      })
      for (const [field, value] of Object.entries(fields)) {
        if (field !== large) expect(payload[field]).toEqual(value)
      }
    },
  )

  test('leaves an oversized frame that is not JSON as it is', () => {
    const raw = `data: ${big}\n\n`

    expect(replayFrame(raw)).toBe(raw)
  })
})
