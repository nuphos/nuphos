import { describe, expect, test } from 'bun:test'

import { liveTurnParts } from '../live-turn'

import { compactTranscriptLine, liveTurnTranscriptLine } from './transcript-read'

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

const correction = {
  type: 'data-steering',
  data: {
    id: 'correction-1',
    text: 'Keep the change local until I approve publication.',
    metadata: {
      version: 1,
      sender: { type: 'user', id: 'ada', displayName: 'Ada' },
      source: 'nuphos',
      sentAt: '2026-10-21T10:00:00Z',
    },
  },
}

test('stored history includes the user correction between the surrounding assistant work', () => {
  const line = compactTranscriptLine({
    index: 2,
    role: 'assistant',
    parts: [
      { type: 'text', text: 'I will inspect the changes.' },
      correction,
      { type: 'tool-bash', input: { command: 'git diff' } },
      { type: 'text', text: 'The local change is ready.' },
    ],
  })

  expect(line).toContain(`Ada (during this turn): ${correction.data.text}`)
  const positions = [
    'I will inspect the changes.',
    correction.data.text,
    '[tool: bash]',
    'The local change is ready.',
  ].map((text) => line.indexOf(text))

  expect(positions.every((position) => position >= 0)).toBe(true)
  expect(positions).toEqual([...positions].sort((a, b) => a - b))
})

test('live history preserves a correction before continuing assistant text', () => {
  const events = [
    { type: 'text-delta', delta: 'I will inspect the changes.' },
    correction,
    { type: 'text-delta', delta: 'The local change is ready.' },
  ]
  const parts = liveTurnParts(events.map((event) => `data: ${JSON.stringify(event)}\n\n`))

  expect(parts).toHaveLength(3)
  const line = liveTurnTranscriptLine(3, {
    startedAt: null,
    updatedAt: null,
    parts: parts ?? [],
  })

  expect(line).toContain(`Ada (during this turn): ${correction.data.text}`)
  expect(line.indexOf(correction.data.text)).toBeLessThan(
    line.indexOf('The local change is ready.'),
  )
})

test('malformed steering is ignored and legacy receipts retain a user label', () => {
  const line = compactTranscriptLine({
    index: 2,
    role: 'assistant',
    parts: [
      { type: 'data-steering', data: null },
      { type: 'data-steering', data: { text: 123 } },
      { type: 'data-steering', data: { text: 'Check the narrow layout too.' } },
    ],
  })

  expect(line).toContain('User (during this turn): Check the narrow layout too.')
  expect(line).not.toContain('123')
})
