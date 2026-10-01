import { describe, expect, test } from 'bun:test'

import { toSlackMrkdwn } from '@/lib/slack/mrkdwn/convert'
import { splitSlackText } from '@/lib/slack/stream-sink/helpers'

// F2 (review round 1): the stream's fallback path splits the agent's raw
// CommonMark into per-message chunks and converts each one independently. A
// fenced code block spanning a split used to leave chunk 2 starting mid-code
// with no opening fence — parsed as ordinary prose, so a `<@U…>` the author put
// inside a code block came back to life as a Slack notification.
describe('splitSlackText — code fences survive the chunk boundary', () => {
  const FILLER = 'x'.repeat(4_000)
  const FENCED = `intro\n\n\`\`\`\n${FILLER}\n<@U123ABC>\n\`\`\`\n\noutro`

  test('a mention inside a split code block stays inert in every chunk', () => {
    const chunks = splitSlackText(FENCED)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(toSlackMrkdwn(chunk)).not.toContain('<@U123ABC>')
    }
  })

  test('every chunk is independently fence-balanced', () => {
    for (const chunk of splitSlackText(FENCED)) {
      const fences = chunk.split('\n').filter((line) => /^ {0,3}(?:`{3,}|~{3,})/.test(line))

      expect(fences.length % 2).toBe(0)
    }
  })

  test('a tilde fence spanning the boundary is reopened too', () => {
    const chunks = splitSlackText(`~~~\n${FILLER}\n<@U123ABC>\n~~~`)

    for (const chunk of chunks) {
      expect(toSlackMrkdwn(chunk)).not.toContain('<@U123ABC>')
    }
  })

  test('text with no fences is chunked exactly as before', () => {
    const plain = `${'word '.repeat(1_500)}tail`
    const chunks = splitSlackText(plain)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join(' ').replace(/\s+/g, ' ').trim()).toBe(plain.replace(/\s+/g, ' ').trim())
    for (const chunk of chunks) expect(chunk).not.toContain('```')
  })

  test('a short fenced message is left as one chunk', () => {
    const short = '```\nconst a = 1\n```'

    expect(splitSlackText(short)).toEqual([short])
  })
})
