import { describe, expect, test } from 'bun:test'

import { compactTranscriptLine } from './transcript-read'

describe('compactTranscriptLine', () => {
  test('summarizes tool calls and truncates long prose', () => {
    expect(
      compactTranscriptLine({
        index: 2,
        role: 'assistant',
        parts: [{ type: 'tool-bash' }, { type: 'text', text: 'done' }],
      }),
    ).toBe('#2 assistant: [tool: bash]\ndone')
    expect(
      compactTranscriptLine({
        index: 1,
        role: 'assistant',
        parts: [{ type: 'tool', toolName: 'web_fetch' }, { type: 'step-start' }],
      }),
    ).toBe('#1 assistant: [tool: web_fetch]')
    expect(
      compactTranscriptLine(
        {
          index: 1,
          role: 'assistant',
          parts: [{ type: 'tool-bash', input: { cmd: 'ls' }, output: 'a\nb' }],
        },
        { includeToolDetails: true },
      ),
    ).toBe('#1 assistant: [tool: bash]\n  input: {"cmd":"ls"}\n  output: a\nb')
    const long = compactTranscriptLine({
      index: 0,
      role: 'user',
      parts: [{ type: 'text', text: 'x'.repeat(5000) }],
    })

    expect(long.endsWith('… [truncated]')).toBe(true)
    expect(long.length).toBeLessThan(4100)
  })
})
