import { expect, test } from 'bun:test'

import { transcriptTurnDiagnostics } from './transcript-diagnostics'
import { compactTranscriptLine } from './transcript-read'

test('legacy interruption at the end of a long transcript remains independently readable', () => {
  const message = {
    index: 7,
    role: 'assistant' as const,
    parts: [
      { type: 'text', text: 'x'.repeat(10000) },
      {
        type: 'turn-interrupted',
        reason: 'timeout',
        message: 'The agent did not respond in time.',
        createdAt: '2026-10-10T09:37:05.701Z',
      },
    ],
  }

  expect(compactTranscriptLine(message)).toContain('[truncated]')
  expect(transcriptTurnDiagnostics(message)).toEqual([
    {
      message_index: 7,
      outcome: 'interrupted',
      reason: 'timeout',
      message: 'The agent did not respond in time.',
      recorded_at: '2026-10-10T09:37:05.701Z',
    },
  ])
})

test('structured diagnostics omit arbitrary payloads and survive without prose', () => {
  const data = {
    streamId: 'run',
    startedAt: '2026-10-10T09:00:00.000Z',
    endedAt: '2026-10-10T09:30:00.000Z',
    elapsedMs: 1800000,
    source: 'runtime',
    error: 'Agent exceeded hard timeout (1800s)',
    authKey: 'secret',
  }
  const result = transcriptTurnDiagnostics({
    index: 2,
    role: 'assistant' as const,
    parts: [{ type: 'turn-interrupted', reason: 'timeout', diagnostics: data }],
  })

  expect(result[0]?.diagnostics?.error).toBe(data.error)
  expect(JSON.stringify(result)).not.toContain('secret')
  expect(
    transcriptTurnDiagnostics({
      index: 2,
      role: 'user',
      parts: [{ type: 'data-turn-diagnostics', data }],
    }),
  ).toEqual([])
  expect(
    transcriptTurnDiagnostics({
      index: 2,
      role: 'assistant',
      parts: [{ type: 'data-turn-diagnostics', data }],
    }),
  ).toEqual([])
})
