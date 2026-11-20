import assert from 'node:assert/strict'

import { test } from 'bun:test'

import { normalizePersistedPart } from './persistence'

// A reopened chat and the local cache rebuild tool parts field by field (#1060).
test('a saved tool part keeps its sub-agent tags in both stored shapes', () => {
  const saved = [
    { type: 'tool', toolCallId: 't', toolName: 'Agent', state: 'output-available', subagent: true },
    { type: 'tool-Read', toolCallId: 'c', state: 'output-available', parentToolUseId: 't' },
  ]

  assert.deepEqual(
    saved.map((part) => {
      const normalized = normalizePersistedPart(part)

      return normalized?.type === 'tool' && [normalized.subagent, normalized.parentToolUseId]
    }),
    [
      [true, undefined],
      [undefined, 't'],
    ],
  )
})
